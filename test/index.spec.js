const nock = require('nock');
const { expect } = require('chai');
const B2 = require('backblaze-b2').default;
const BackblazeB2Adapter = require('../dist/index');

const testPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');

describe('BackblazeB2Adapter', function() {
	const scope = nock(`https://api.backblazeb2.com/b2api/v2`);

	scope.get('/b2_authorize_account').reply(200, {
		"accountId": "000000000000",
		"authorizationToken": "abcdefghijklmnopqrstuvwxyz01234",
		"allowed": {
			"bucketId": "012345",
			"bucketName": "my_bucket",
			"capabilities": [],
		},
		"apiUrl": "https://api.backblazeb2.com",
		"downloadUrl": "https://fNNN.backblazeb2.com",
		"recommendedPartSize": 10000,
		"absoluteMinimumPartSize": 5000
	});

	const adapter = new BackblazeB2Adapter({
		applicationKeyId: 'key_id',
		applicationKey: 'key',
		bucketId: '012345',
	});

	describe('construct()', function() {
		it('should construct an instance of the B2 API Client', function(done) {
			expect(adapter.b2).to.be.an.instanceOf(B2);

			this.timeout(3000);
			setTimeout(done, 2000);
		});

		it('should authorize the B2 API Client', function(done) {
			expect(adapter.b2.authorization.lastUpdate).to.be.an.instanceOf(Date)
			done();
		})
	});

	describe('getDownloadUrl()', function() {
		it('should return the correct URL as a string', function(done) {
			expect(adapter.getDownloadUrl()).to.equal('https://fNNN.backblazeb2.com/file/my_bucket');
			expect(adapter.getDownloadUrl('folder')).to.equal('https://fNNN.backblazeb2.com/file/my_bucket/folder');
			done();
		});
	});

	describe('upload()', function() {
		it('should upload a Buffer and return the URL', async function() {
			const buffer = Buffer.from('');

			scope.post('/b2_get_upload_url').reply(200,
				{
					"bucketId" : "012345",
					"uploadUrl" : "https://api.backblazeb2.com/b2api/v2/b2_upload_file",
					"authorizationToken" : "abcdef"
				}
			).post('/b2_upload_file').reply(200);

			expect(await adapter.saveRaw(buffer, 'test.jpeg')).to.equal('https://fNNN.backblazeb2.com/file/my_bucket/test.jpeg');
		});
	});
	
	describe('saveRaw()', function() {
		it('should upload a buffer and return a URL', async function() {
			scope.post('/b2_get_upload_url').reply(200,
				{
					"bucketId" : "012345",
					"uploadUrl" : "https://api.backblazeb2.com/b2api/v2/b2_upload_file",
					"authorizationToken" : "abcdef"
				}
			).post('/b2_upload_file').reply(200);

			expect(await adapter.saveRaw(testPng, 'test.png')).to.equal('https://fNNN.backblazeb2.com/file/my_bucket/test.png');
		});
	});

	describe('save()', function() {
		it('should read a file from disk and return the URL', async function() {
			const targetDir = adapter.getTargetDir();

			scope.post('/b2_get_upload_url').reply(200,
				{
					"bucketId" : "012345",
					"uploadUrl" : "https://api.backblazeb2.com/b2api/v2/b2_upload_file",
					"authorizationToken" : "abcdef"
				}
			).post('/b2_upload_file').reply(200);

			expect(await adapter.save({
				name: 'test.png',
				path: './test/test.png',
			})).to.equal(`https://fNNN.backblazeb2.com/file/my_bucket/${targetDir}/test.png`);
		});
	});

	describe('exists()', function() {
		const targetDir = adapter.getTargetDir();

		it('should return true for a file that does exist', async function() {
			nock('https://fNNN.backblazeb2.com').head(`/file/my_bucket/${targetDir}/test.png`).reply(200);

			expect(await adapter.exists('test.png')).to.equal(true);
		});

		it('should return false for a file that does not exist', async function() {
			nock('https://fNNN.backblazeb2.com').head(`/file/my_bucket/${targetDir}/not_found.gif`).reply(404);

			expect(await adapter.exists('not_found.gif')).to.equal(false);
		});
	});

	describe('delete()', function() {
		it('should return true when a file is deleted');
	});

	describe('read()', function() {
		it('should download a file and return a buffer', async function() {
			nock('https://fNNN.backblazeb2.com').get('/file/my_bucket/test.png').replyWithFile(200, './test/test.png');

			expect((await adapter.read({
				path: 'https://fNNN.backblazeb2.com/file/my_bucket/test.png'
			})).toString()).to.equal(testPng.toString());
		});
	});
});
