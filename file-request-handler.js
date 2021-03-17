// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

class FileRequestHandler {
    constructor(s3, secretsManager) {
        this.s3 = s3;
        this.secretsManager = secretsManager;
    }


    consoleLog(message){
        console.log(message);
    }
    /**
     * Initializer function for creating a new image request, used by the image
     * handler to perform image modifications.
     * @param {object} event - Lambda request body.
     */
    async setup(event) {
        try {

            this.bucket = this.parseFileBucket(event);
            this.key = this.parseFileKey(event);
            if(this.checkAccess(this.key)){
                this.originalFile = await this.getOriginalFile(this.bucket, this.key);
                if (!this.headers) {
                    delete this.headers;
                }
                return this;
            }else{
                await Promise.reject(new Error('Invalid operation'));
            }
        } catch (err) {
            console.error(err);
            throw err;
        }
    }

    /**
     * Gets the original image from an Amazon S3 bucket.
     * @param {string} bucket - The name of the bucket containing the image.
     * @param {string} key - The key name corresponding to the image.
     * @return {Promise} - The original image or an error.
     */
    async getOriginalFile(bucket, key) {
        const fileLocation = { Bucket: bucket, Key: key };
        try {
            const originalFile = await this.s3.getObject(fileLocation).promise();
            this.ContentType = originalFile.ContentType;

            if (originalFile.CacheControl) {
                this.CacheControl = originalFile.CacheControl;
            } else {
                this.CacheControl = "max-age=31536000,public";
            }
            return originalFile.Body;
        } catch(err) {
            throw {
                status: ('NoSuchKey' === err.code) ? 404 : 500,
                code: err.code,
                message: err.message + " File Key : "+key
            };
        }
    }

    /**
     * Parses the name of the appropriate Amazon S3 bucket to source the
     * original image from.
     * @param {string} event - Lambda request body.
     * @param {string} requestType - Image handler request type.
     */
    parseFileBucket(event) {
            const sourceBuckets = this.getAllowedSourceBuckets();
            return sourceBuckets[0];
    }

    /**
     * Parses the name of the appropriate Amazon S3 key corresponding to the
     * original image.
     * @param {String} event - Lambda request body.
     * @param {String} requestType - Type, either "Default", "Thumbor", or "Custom".
     */
    parseFileKey(event) {
        try{
            let s3_file_path = event.path.replace(/((\bdownload\/\b)|)/g,'').replace(/\)/g, '').replace(/^\/+/, '');
            this.consoleLog("S3 Final Path : "+s3_file_path);
            return decodeURIComponent(s3_file_path);
        }catch (e) {
            throw ({
                status: 404,
                code: 'FileEdits::CannotFindFile',
                message: 'The file you specified could not be found. Please check your request syntax as well as the bucket you specified to ensure it exists.'
            });
        }
    }


    /**
     * Decodes the base64-encoded image request path associated with default
     * image requests. Provides error handling for invalid or undefined path values.
     * @param {object} event - The proxied request object.
     */
    decodeRequest(event) {
        const path = event["path"];
        if (path !== undefined) {
            const encoded = path.charAt(0) === '/' ? path.slice(1) : path;
            const toBuffer = Buffer.from(encoded, 'base64');
            try {
                // To support European characters, 'ascii' was removed.
                return JSON.parse(toBuffer.toString());
            } catch (e) {
                throw ({
                    status: 400,
                    code: 'DecodeRequest::CannotDecodeRequest',
                    message: 'The image request you provided could not be decoded. Please check that your request is base64 encoded properly and refer to the documentation for additional guidance.'
                });
            }
        } else {
            throw ({
                status: 400,
                code: 'DecodeRequest::CannotReadPath',
                message: 'The URL path you provided could not be read. Please ensure that it is properly formed according to the solution documentation.'
            });
        }
    }

    /**
     * Returns a formatted image source bucket whitelist as specified in the
     * SOURCE_BUCKETS environment variable of the image handler Lambda
     * function. Provides error handling for missing/invalid values.
     */
    getAllowedSourceBuckets() {
        const sourceBuckets = process.env.SOURCE_BUCKETS;
        if (sourceBuckets === undefined) {
            throw ({
                status: 400,
                code: 'GetAllowedSourceBuckets::NoSourceBuckets',
                message: 'The SOURCE_BUCKETS variable could not be read. Please check that it is not empty and contains at least one source bucket, or multiple buckets separated by commas. Spaces can be provided between commas and bucket names, these will be automatically parsed out when decoding.'
            });
        } else {
            const formatted = sourceBuckets.replace(/\s+/g, '');
            const buckets = formatted.split(',');
            return buckets;
        }
    }

    async process(request) {
        const bufferImage = Buffer.from(request.originalFile, 'base64');
        let returnFile = bufferImage.toString('base64');
        // If the converted image is larger than Lambda's payload hard limit, throw an error.
        const lambdaPayloadLimit = 6 * 1024 * 1024;
        if (returnFile.length > lambdaPayloadLimit) {
            throw {
                status: '413',
                code: 'TooLargeImageException',
                message: 'The converted image is too large to return.'
            };
        }

        return returnFile;
    }

    checkAccess(key) {
        try{
            let folder = key.split('/')[0];
            this.consoleLog("Folder Array : "+folder);
            let allowed_folders = ['csv_images','inventory-csv','processing-csv','sample-csv'];
            this.consoleLog("Allowed : "+allowed_folders.includes(folder));
            return allowed_folders.includes(folder);
        }catch (e) {
            throw {
                status: '403',
                code: 'Invalid folder access',
                message: 'The path you are trying to access in not allowed'
            };
        }
    }
}

// Exports
module.exports = FileRequestHandler;