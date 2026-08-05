
import axios from 'axios'

const api = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL,
    withCredentials: true  //// sends the auth cookie once auth exists
})

export async function signup(email, password) {
  const res = await api.post('/api/auth/signup', { email, password });
  return res.data;
}

export async function login(email, password) {
  const res = await api.post('/api/auth/login', { email, password });
  return res.data;
}


export async function logout() {
  const res = await api.post('/api/auth/logout');
  return res.data;
}

export async function getCurrentUser() {
  const res = await api.get('/api/auth/me');
  return res.data; // { userId }
}


export async function uploadCsvFile(file, onUploadProgress) {
    const formData = new FormData();  /*FormData is a built-in JavaScript object that lets you collect and send form fields (including files) in the same format that an HTML form uses when submitted (multipart/form-data).  
    This creates an empty FormData object.
    It's mainly used when:
    ✅ Uploading files (images, PDFs, CSVs, videos)
    ✅ Sending form data without converting it to JSON
    In this project  use FormData to upload CSV files.*/
    formData.append('file', file)  //formData.append(key, value);

    const res = await api.post('/api/import', formData, {
        headers: { 'Content-Type': 'multipart/formData' },
        onUploadProgress:(event)=>{
            if(!onUploadProgress || !event.total) return;
            const percent = Math.round((event.loaded/event.total)*100)
            onUploadProgress(percent)
        }
    })



    return res.data  // expected shape: { jobId: string }

}

export async function fetchJobStatus(jobId) {
    const res = await api.get(`/api/jobs/${jobId}`); // { status: 'pending'|'processing'|'completed'|'failed', totalRows, processedRows, imported: [...], skipped: [...] }

    return res.data
}