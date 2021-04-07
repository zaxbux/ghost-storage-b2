import fs from 'fs';
import path from 'path';
import Debug from 'debug';
import B2 from 'backblaze-b2';
import B2Bucket from 'backblaze-b2/dist/bucket';
import errors from '@tryghost/errors';
import  StorageBase from 'ghost-storage-base';

const debug = Debug('ghost-storage-b2');

/**
 * @typedef  {Object} AdapterConfig    Ghost storage adapter configuration object.
 * @property {string} applicationKeyId The application key ID for the B2 API.
 * @property {string} applicationKey   The application key for the B2 API.
 * @property {string} bucketId         The ID of the B2 bucket.
 * @property {string} [bucketName]     The name of the B2 bucket.
 * @property {string} [pathPrefix]     Optional path to the root of B2 storage.
 * @property {string} [downloadUrl]    The remote address of the B2 endpoint.
 */

/**
 * @typedef {import('ghost-storage-base').Image} Image
 */

/**
 * @typedef {Object} ReadOptions
 * @property {string} path
 */

/**
 * @classdesc Backblaze B2 storage adapter class for the Ghost publishing platform.
 * @version 0.0.1
 * @author Zachary Schneider <hello@zacharyschneider.ca>
 * @augments StorageBase
 */
class BackblazeB2Adapter extends StorageBase {
	/**
	 * Create a Backblaze B2 adapter.
	 * 
	 * @constructor
	 * @throws {Error}
	 * @param {AdapterConfig} config
	 */
	constructor(config = {}) {
		super();

		/**
		 * @private
		 * @type {object}
		 */
		this.config = {
			applicationKeyId: process.env.B2_APPLICATION_KEY_ID || config.applicationKeyId,
			applicationKey:   process.env.B2_APPLICATION_KEY    || config.applicationKey,
			bucketId:         process.env.B2_BUCKET_ID          || config.bucketId,
			bucketName:       process.env.B2_BUCKET_NAME        || config.bucketName,
			downloadUrl:      process.env.B2_DOWNLOAD_URL       || config.downloadUrl,
			pathPrefix:       process.env.B2_PATH_PREFIX        || config.pathPrefix,
		};

		if (!this.config.applicationKeyId || !this.config.applicationKey || !this.config.bucketId) {
			throw new Error('B2 storage adaptor requires applicationKey, applicationKeyId, and bucketId.');
		}

		/**
		 * @private
		 * @type {B2}
		 */
		this.b2 = new B2({
			applicationKeyId: this.config.applicationKeyId,
			applicationKey: this.config.applicationKey,
		}, {
			axios: {
				headers: {
					'User-Agent': `ghost-storage-b2/0.0.1 github.com/zaxbux/ghost-storage-b2`,
				},
			},
		});

		/**
		 * @private
		 * @type {B2Bucket}
		 */
		this.bucket = null;
		
		// Call async methods outside of the constructor
		this.authorize();
	}

	/**
	 * Authorize the B2 API client and get the bucket information.
	 * @private
	 */
	async authorize() {
		// Get an authorization token
		await this.b2.authorize();

		debug(`B2 Account: ${this.b2.authorization.accountId}`);

		if (this.config.bucketId && this.config.bucketName) {
			this.bucket = new B2Bucket({
				bucketId:   this.config.bucketId,
				bucketName: this.config.bucketName,
			}, this.b2);
		}
	
		if (!this.bucket) {
			// Use the bucket name from the auth request, if available
			if (this.b2.authorization.hasBucketRestriction(this.config.bucketId)) {
				debug(`B2 Application Key restriction found, using that bucket`);

				// Create a bare-bones bucket object
				this.bucket = new B2Bucket({
					bucketId:   this.b2.authorization.getBucketRestriction().bucketId,
					bucketName: this.b2.authorization.getBucketRestriction().bucketName,
				}, this.b2);
			} else {
				debug('Contacting B2 API for bucket name...');
				// Get bucket name from B2 API
				await this.b2.bucket.get({ bucketId: this.config.bucketId }).then((bucket) => {
					this.bucket =  bucket;
				});
			}
		}
	
		debug(`B2 Bucket: ${this.bucket.bucketName}#${this.bucket.bucketId}`);

		// Use download URL from authorization response if not already set
		if (!this.config.downloadUrl) {
			this.config.downloadUrl = `${this.b2.authorization.downloadUrl}/file/${this.bucket.bucketName}`;
		}

		debug(`Download URL: ${this.config.downloadUrl}`);
		
	}
	
	/**
	 * Saves a buffer at targetPath, enables Ghost's automatic responsive images.
	 * @param {Buffer} buffer File buffer
	 * @param {string} targetPath File name
	 * @returns {Promise<string>}
	 */
	async saveRaw(buffer, targetPath) {
		debug(`saveRaw( targetPath: '${targetPath}' )`);

		const storagePath = path.join(this.config.pathPrefix || '', targetPath);
		//const targetDir = path.dirname(storagePath);

		return await this.upload(buffer, storagePath);
	}

	/**
	 * Read a file and upload to B2.
	 * @param {Image} image File path to image.
	 * @param {string} targetDir 
	 * @returns {Promise<string>}
	 */
	async save(image, targetDir) {
		debug(`save( image: '${JSON.stringify(image)}', target: '${targetDir}' )`);

		const directory = path.join(this.config.pathPrefix, targetDir || this.getTargetDir());

		const buffer = fs.readFileSync(image.path);
		// StorageBase.getUniqueFileName() returns a {Promise}, await is necessary
		const name = await this.getUniqueFileName(image, directory);
		return await this.upload(buffer, name);
	}

	/**
	 * Check whether the file exists or not.
	 * @param {string} fileName File path.
	 * @param {string} [targetDir] Target
	 * @returns {Promise<boolean>}
	 */
	async exists(fileName, targetDir) {
		debug(`exists( fileName: '${fileName}', target: '${targetDir}' )`);

		const filePath = path.join(this.config.pathPrefix, targetDir || this.getTargetDir(), fileName);

		const exists = await this.bucket.fileExists({
			fileName: filePath,
		});

		debug(`\t Result: ${exists}`);

		return exists;
	}

	/**
	 * @static
	 * @returns {function(*, *, *)} No-op, since requests are made directly to Backblaze
	 */
	serve() {
		return (req, res, next) => {
			next();
		};
	}

	/**
	 * Delete all versions of a file.
	 * 
	 * @param {string} fileName
	 * @param {string} [targetDir]
	 * @returns {Promise<boolean>}
	 */
	async delete(fileName, targetDir) {
		debug(`delete( fileName: '${fileName}', target: '${targetDir}' )`);
		const filePath = path.join(this.config.pathPrefix, targetDir || this.getTargetDir(), fileName);

		debug(`\tB2 file name: ${filePath}`);

		const count = this.b2.file.deleteAllVersions({
			bucketId: this.config.bucketId,
			fileName: filePath,
		});

		debug(`\t Deleted ${count} versions`);

		return count > 0;
	}

	/**
	 * Reads bytes from the B2 endpoint and returns them as a buffer.
	 * 
	 * @param {ReadOptions} options The file to download from B2.
	 * 
	 * @returns {Promise<Buffer>}
	 */
	async read(options) {
		debug(`read( ${JSON.stringify(options)} )`);

		const fileName = options.path.replace(this.getDownloadUrl(''), '');

		debug(`\tB2 file name: ${fileName}`)

		try {
			const response = await this.b2.file.downloadByName({
				bucketName: this.bucket.bucketName,
				fileName: fileName,
				axios: {
					responseType: 'arraybuffer',
				},
			});

			if (response.status === 200) {
				debug(`\tDownloaded ${response.headers['content-length']} bytes`);

				return Buffer.from(response.data, 'binary');
			}

		} catch (error) {
			const statusCode = error.axiosError.response.status;
			let message;

			if (error.axiosError.response.data && error.axiosError.response.data.code) {
				message = error.axiosError.response.data.code;
			}

			switch (statusCode) {
				case 400:
					throw new errors.BadRequestError({ message });

				case 401:
					throw new errors.UnauthorizedError({ message });

				case 403:
					throw new errors.NoPermissionError({ message });

				case 404:
					throw new errors.NotFoundError({ message });
				
				default:
					throw new errors.InternalServerError({ message });
			}
		}
	}

	/**
	 * Get the absolute URL for a file.
	 * @private
	 * @param {string} filePath The file path.
	 * @returns {string}
	 */
	getDownloadUrl(filePath) {
		return `${this.config.downloadUrl}/${filePath}`;
	}

	/**
	 * Upload a file buffer to B2.
	 * @private
	 * @param {Buffer}  buffer   The file data.
	 * @param {string}  fileName The name to store the buffer at.
	 * @returns {Promise<string>} The URL to download the file.
	 */
	async upload(buffer, fileName) {
		debug(`upload( fileName: '${fileName}' )`);

		const response = await this.b2.file.upload({
			fileName: fileName,
			bucketId: this.config.bucketId,
			data: buffer,
		});

		if (response.status === 200) {
			debug(`\t B2 File ID: ${response.data.fileId}`);

			const url = this.getDownloadUrl(fileName);

			debug(`\t URL: ${url}`);

			return url;
		}
	}
}

export default BackblazeB2Adapter;
