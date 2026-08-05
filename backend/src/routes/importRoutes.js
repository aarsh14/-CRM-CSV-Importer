import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../middleware/authMiddleware.js";
import { uploadImport, getJobStatus } from "../controllers/importController.js";

const router = Router();

const upload = multer({
  dest: "temp-uploads/",
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB cap — reasonable for a learning project
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith(".csv")) {
      return cb(new Error("Only .csv files are allowed"));
    }
    cb(null, true);
  },
});

router.post("/import", requireAuth, upload.single("file"), uploadImport);  //'file'  comming from client.js in frontend
router.get("/jobs/:id", requireAuth, getJobStatus);

export default router;
