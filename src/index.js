export default {
  async fetch(request, env) {
    const bucket = env.MY_BUCKET;

    if (!bucket) {
      return new Response("R2 bucket not bound", { status: 500 });
    }

    try {
      const listResponse = await bucket.list(); // List all files

      const files = listResponse.objects.map(obj => ({
        key: obj.key,                         // File name
        size: formatBytes(obj.size),         // Size in readable format
        type: getMimeTypeFromExtension(obj.key), // Mime type from extension
        class: obj.storageClass || "Standard",   // Storage class (assumed Standard)
        modified: obj.uploaded.toISOString() // Last modified
      }));

      return new Response(JSON.stringify({ files }, null, 2), {
        headers: { "Content-Type": "application/json" }
      });

    } catch (err) {
      return new Response("Error: " + err.message, { status: 500 });
    }
  }
};

// Convert bytes to human-readable string
function formatBytes(bytes) {
  const sizes = ["Bytes", "kB", "MB", "GB"];
  if (bytes === 0) return "0 Byte";
  const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
  return (bytes / Math.pow(1024, i)).toFixed(2) + " " + sizes[i];
}

// Infer MIME type from filename
function getMimeTypeFromExtension(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    webp: "image/webp",
    avif: "image/avif",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png"
  };
  return map[ext] || "application/octet-stream";
}
