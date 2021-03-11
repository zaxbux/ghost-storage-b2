import fs from 'fs';
import path from 'path';
import Debug from 'debug';
import B2 from 'backblaze-b2';
import Promise from 'bluebird';
import { errors } from '@tryghost/errors';
import BaseStorage from 'ghost-storage-base';

const debug = Debug('ghost-storage-b2');
const readFileAsync = Promise.promisify(fs.readFile);

/**
 * @typedef  {Object}  AdapterConfig    Ghost storage adapter configuration object.
 * @property {string}  applicationKeyId The application key ID for the B2 API.
 * @property {string}  applicationKey   The application key for the B2 API.
 * @property {string}  bucketId         The ID of the B2 bucket.
 * @property {string}  bucketName       The name of the B2 bucket.
 * @property {string=} pathPrefix       Optional path to the root of B2 storage.
 * @property {string=} downloadUrl      The remote address of the B2 endpoint.
 */

/**
 * @typedef {Object} Image
 * @property {string} name
 * @property {string} path
 */

/**
 * @typedef {Object} ReadOptions
 * @property {string} path
 */

/**
 * Backblaze B2 storage adapter class for the Ghost v3.x publishing platform.
 * @version 0.0.1
 * @author Zachary Schneider <hello@zacharyschneider.ca>
 * @extends StorageBase
 */
class BackblazeB2Adapter extends BaseStorage {
	/**
	 * Create a Backblaze B2 adapter.
	 * @constructor
	 * @throws {Error}
	 * @param {AdapterConfig} config
	 */
	constructor(config = {}) {
		super();

		// Create configuration
		this._config = {
			applicationKeyId: process.env.B2_APPLICATION_KEY_ID || config.applicationKeyId,
			applicationKey:   process.env.B2_APPLICATION_KEY    || config.applicationKey,
			bucketId:         process.env.B2_BUCKET_ID          || config.bucketId,
			bucketName:       process.env.B2_BUCKET_NAME        || config.bucketName,
			downloadUrl:      process.env.B2_DOWNLOAD_URL       || config.downloadUrl,
			pathPrefix:       process.env.B2_PATH_PREFIX        || config.pathPrefix,
		};

		if (!this._config.applicationKeyId || !this._config.applicationKey || !this._config.bucketId) {
			throw new Error('B2 storage adaptor requires applicationKey, applicationKeyId, and bucketId.');
		}

		// Initialize API client
		this.client = new B2({
			applicationKeyId: this._config.applicationKeyId,
			applicationKey: this._config.applicationKey,
			axiosOverride: {
				headers: {
					'User-Agent': `ghost-storage-b2/0.0.1 github.com/zaxbux/ghost-storage-b2`,
				},
			},
		});

		// Get an authorization token
		this._authorize().then((res) => {
			debug(`authorized for account: ${res.data.accountId}`);

			// Use the bucket name from the auth request, if available
			if (res.data.allowed.bucketId === this._config.bucketId) {
				this._config.bucketName = res.data.allowed.bucketName;
				debug(`app key bucket restriction: ${this._config.bucketName}`);
			}

			// Bucket name not set, get bucket name from B2 API
			if (!this._config.bucketName) {
				this._config.bucketName = this._getBucketName(this._config.bucketId);
				debug(`got bucket name: ${this._config.bucketName}`);
			}
		});
	}
	
	/**
	 * Saves a buffer at targetPath, enables Ghost's automatic responsive images.
	 * @param {Buffer} buffer File buffer
	 * @param {string} targetPath File name
	 * @returns {Promise.<*>}
	 */
	saveRaw(buffer, targetPath) {
		debug(`saveRaw -> ${targetPath}`);

		const storagePath = path.join(this._config.pathPrefix || '', targetPath);
		const targetDir = path.dirname(storagePath);

		return this._upload(buffer, storagePath);
	}

	/**
	 * Read a file and upload to B2.
	 * @param {Image} image File path to image.
	 * @param {string} targetDir 
	 * @returns {Promise.<*>}
	 */
	save(image, targetDir) {
		debug(`save -> ${image.path} / ${image.name} @ target: ${targetDir}`);

		const directory = targetDir || this.getTargetDir(this.pathPrefix);

		return new Promise((resolve, reject) => {
			Promise.all([
				readFileAsync(image.path),
				this.getUniqueFileName(image, directory),
			])
			.then(([buffer, fileName]) => resolve(this._upload(buffer, fileName)))
			.catch(error => reject(error));
		})
	}

	/**
	 * Check whether the file exists or not.
	 * @param {string} fileName File path.
	 * @param {string} targetDir
	 * @returns {Promise.<boolean>}
	 */
	exists(fileName, targetDir) {
		debug(`exists -> ${fileName} @ target ${targetDir}`);

		return new Promise((resolve, reject) => {
			const filePath = path.join(targetDir || this.getTargetDir(this._config.pathPrefix), fileName);

			debug(`exists -> filePath: ${filePath}`);

			/*this.client.listFileVersions({
				bucketId: this.bucketId,
				prefix: filePath,
			}).then((res) => {
				if (res.status !== 200) {
					debug(`exists (error) ->`, res.data);

					return reject(res.data.code);
				}

				resolve(res.data.files.length > 0);
			});*/
			this.client.downloadFileByName({
				bucketName: this._config.bucketName,
				fileName: filePath,
				axios: {
					method: 'head',
				}
			}).then((res) => {
				if (res.status === 200) {
					debug('exists -> true');
					resolve(true);
				}

				if (res.status === 404) {
					debug('exists -> false');
					resolve(false);
				}

				debug(`exists (error) ->`, res.data);

				reject(res.data.code);
			});
		});
	}

	/**
	 * No-op, since requests are made directly
	 * @static
	 * @returns {function(*, *, *)}
	 */
	serve() {
		return (req, res, next) => {
			next();
		};
	}

	/**
	 * Delete all versions of a file.
	 * @param {string} fileName
	 * @param {string=} targetDir
	 * @returns {Promise.<boolean>}
	 */
	delete(fileName, targetDir = null) {
		debug(`delete -> ${fileName} @ target ${targetDir}`);
		const filePath = path.join(targetDir || this.getTargetDir(this._config.pathPrefix), fileName);

		debug(`delete file: ${filePath}`);

		this.client.listFileVersions({
			bucketId: this.bucketId,
			prefix: filePath,
			//startFileName: filePath,
			maxFileCount: 1000
		}).then((res) => {
			res.data.files.forEach((file) => {
				debug(`delete file version: ${file.fileId}`);

				this.client.deleteFileVersion({
					fileId: file.fileId,
					fileName: filePath,
				});
			})
		});
	}

	/**
	 * Reads bytes from the B2 endpoint and returns them as a buffer.
	 * @param {ReadOptions} options
	 * @returns {Promise.<*>}
	 */
	read(options) {
		debug(`ghost-storage-b2] read -> ${options.path}`);

		return new Promise((resolve, reject) => {
			this.client.downloadFileByName({
				bucketName: this._config.bucketName,
				fileName: options.path,
				axios: {
					responseType: 'arraybuffer',
				},
			}).then((res) => {
				if (res.status === 200) {
					debug('read (success)')
					resolve(Buffer.from(res.data, 'binary'));
				}

				reject(this._readError(res));
			});
		});
	}

	/**
	 * Authorize the B2 API client.
	 * @private
	 * @returns {Promise.<*>}
	 */
	_authorize() {
		debug('Requesting authorization token');

		return this.client.authorize();
	}

	/**
	 * Get the name for the bucket from it's ID.
	 * @private
	 * @param {string}  bucketId The ID of the bucket.
	 * @returns {Promise.<string>}
	 */
	_getBucketName(bucketId) {
		return new Promise ((resolve, reject) => {
			this.client.getBucket({
				bucketId: bucketId,
			}).then((res) => {
				const buckets = res.data.buckets || [];
				
				if (!buckets[0]) {
					return reject('bucket not found');
				}

				resolve(buckets[0].bucketId);
			});
		});
	}

	/**
	 * Get the absolute URL for a file.
	 * @private
	 * @param {string} filePath The file path.
	 * @returns {string}
	 */
	_getDownloadUrl(filePath) {
		if (this._config.downloadUrl) {
			return `${this._config.downloadUrl}/${filePath}`;
		}

		return `${this.client.downloadUrl}/file/${this._config.bucketName}/${filePath}`;
	}

	/**
	 * Upload a file buffer to B2.
	 * @private
	 * @param {string}  fileName The name to store the buffer at.
	 * @param {Buffer}  buffer   The file data.
	 * @param {boolean} reAuth   Obtain another authorization token if necessary.
	 * @returns {Promise.<*>}
	 */
	_upload(fileName, buffer, reAuth = true) {
		return new Promise((resolve, reject) => {
			this.client.getUploadUrl({
				bucketId: this._config.bucketId,
			}).then((res) => {
				if (res.status == 401 && (res.data.code == 'bad_auth_token' || res.data.code == 'expired_auth_token')) {
					debug('Get upload URL failed:', res.data.message);

					if (!reAuth) {
						return reject(res.data.code);
					}

					// re-authorize
					this.client.authorize().then(() => {
						debug('re-auth')
						return resolve(this._upload(fileName, buffer, false));
					});
				}

				debug(`Starting upload for ${fileName}`)

				this.client.uploadFile({
					uploadUrl: res.data.uploadUrl,
					uploadAuthToken: res.data.authorizationToken,
					fileName: fileName,
					data: buffer
				}).then((res) => {
					debug(`Uploaded: ${fileName}`)
					return resolve(`${this._getDownloadUrl(fileName)}`);
				});
			});
		});
	}

	/**
	 * Resolve a B2 API error into a Ghost error.
	 * @private
	 * @param res The API response.
	 * @returns {Error}
	 */
	_readError(res) {
		if (res.status === 400) {
			debug(`read (error) -> ${res.data.code}`)
			return new errors.BadRequestError({
				message: res.data.code || undefined,
			});
		}

		if (res.status === 401) {
			debug(`read (error) -> ${res.data.code}`)
			return new errors.UnauthorizedError({
				message: res.data.code || undefined,
			});
		}

		if (res.status === 403) {
			debug(`read (error) -> ${res.data.code}`)
			return new errors.NoPermissionError({
				message: res.data.code || undefined,
			});
		}

		if (res.status === 404) {
			debug(`read (error) -> ${res.data.code}`)
			return new errors.NotFoundError({
				message: res.data.code || undefined,
			});
		}
		
		debug(`read (error) -> ${res.data.code}`)
		return new errors.InternalServerError({
			message: res.data.code || undefined,
		});
	}
}

export default BackblazeB2Adapter;
