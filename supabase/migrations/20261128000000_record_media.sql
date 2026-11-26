-- Photos and videos: videos up to 200 MB (photos are shrunk in the browser before upload).
-- The project's global upload limit (Storage settings) must be at least this for it to apply.
update storage.buckets set file_size_limit = 209715200 where id = 'record-files';
