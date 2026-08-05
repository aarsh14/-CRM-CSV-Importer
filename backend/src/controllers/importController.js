import { ImportJob } from '../models/importJob.js';
import { ImportRecord } from '../models/importRecord.js';
import { processImportJob } from '../services/csvStreamService.js';
import { logger } from '../utils/logger.js';

export async function uploadImport(req, res, next) {
  try {
    if (!req.file) { //req.file is possible because multer recieved the file
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const job = await ImportJob.create({
      user: req.userId,
      originalFileName: req.file.originalname,
      status: 'pending',
    });

    // Respond immediately — don't make the client wait for processing.
    res.status(202).json({ jobId: job._id });

    // Fire off background processing AFTER responding. Not awaited here
    // on purpose — this request is already done. Errors inside are caught
    // and recorded on the job itself (see csvStreamService.js), not thrown
    // back to this request, since this request has already finished.
    processImportJob(job._id, req.file.path).catch((err) => {  //filepath is temp-uploads
      logger.error('Unhandled error in background import processing', {
        jobId: job._id,
        error: err.message,
      });
    });
  } catch (err) {
    next(err);
  }
}

export async function getJobStatus(req, res, next) {
  try {
    const job = await ImportJob.findOne({ _id: req.params.id, user: req.userId });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const response = {
      status: job.status,
      totalRows: job.totalRows,
      processedRows: job.processedRows,
      importedCount: job.importedCount,
      skippedCount: job.skippedCount,
      errorMessage: job.errorMessage,
    };

    // only fetch the (potentially large) row-level records once the job is done
    if (job.status === 'completed') {
      const [imported, skipped] = await Promise.all([
        ImportRecord.find({ job: job._id, status: 'imported' }).lean(),
        ImportRecord.find({ job: job._id, status: 'skipped' }).lean(),
      ]);
      response.imported = imported;
      response.skipped = skipped;
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
}
