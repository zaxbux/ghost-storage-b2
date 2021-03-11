# Backblaze B2 Storage Adapter for Ghost

A [Backblaze B2](https://www.backblaze.com/b2/docs/) storage adapter for [Ghost](https://ghost.org) version 3.

## Installation

```
git clone https://github.com/zaxbux/ghost-storage-b2.git
cd ghost-storage-b2; npm i
cd ..
cp -r ghost-storage-b2 ./content/adapters/storage/b2
```

## Configuration

You will need to obtain or create app keys and create a bucket in your B2 Cloud Storage Account.

If your Ghost configuration file, add the B2 configuration options:

```json
{
	// ...

	"storage": {
		"active": "b2",
		"b2": {
			"applicationKeyId": "",
			// See table below for config values
		}
	}

	// ...
}
```

Alternatively, the B2 storage adapter can be configured with environment variables:

| JSON File Key      | Environment Variable    | Value
| ------------------ | ----------------------- | -----
| `applicationKeyId` | `B2_APPLICATION_KEY_ID` | Your B2 application key ID
| `applicationKey`   | `B2_APPLICATION_KEY`    | Your B2 application key
| `bucketId`         | `B2_BUCKET_ID`          | Your B2 bucket's ID
| `bucketName`       | `B2_BUCKET_NAME`        | (optional) Your bucket's name
| `pathPrefix`       | `B2_PATH_PREFIX`        | (optional) The prefix to add to uploads
| `downloadUrl`      | `B2_DOWNLOAD_URL`       | (optional) Use a custom URL for downloading. (CDN, etc.)

## Debugging

To debug the storage adapter, set the `DEBUG` environment variable to `ghost-storage-b2`.

## Licence

[MIT](license)