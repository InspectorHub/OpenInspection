/**
 * The size ceiling for one photo body. The server refuses anything larger with 413 (`assertPhotoSize`), and the web
 * pending store refuses it before queueing; both read this one number so the browser never queues a photo the server
 * would permanently refuse.
 */
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
