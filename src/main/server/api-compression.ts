import compression from 'compression';
import { Request, Response } from 'express';

const COMPRESSION_THRESHOLD_BYTES = 1024;

// `compression` considers `text/event-stream` compressible, but a gzip/brotli
// stream only flushes on end or when its internal buffer fills, so a compressed
// SSE body arrives in one burst instead of streaming. Server-sent events are
// therefore left alone; everything else (settings, transcripts, diffs) still
// benefits from compression.
const shouldCompress = (req: Request, res: Response): boolean => {
  const contentType = res.getHeader('Content-Type');
  if (typeof contentType === 'string' && contentType.toLowerCase().startsWith('text/event-stream')) {
    return false;
  }
  return compression.filter(req, res);
};

export const apiCompressionMiddleware = () => compression({ threshold: COMPRESSION_THRESHOLD_BYTES, filter: shouldCompress });
