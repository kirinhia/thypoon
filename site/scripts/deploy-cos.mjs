import COS from 'cos-nodejs-sdk-v5';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SECRET_ID  = process.env.COS_SECRET_ID;
const SECRET_KEY = process.env.COS_SECRET_KEY;
const REGION     = 'ap-guangzhou';
const BUCKET     = 'kirinhuang';
const APP_ID     = '1385358668';
const FULL_BUCKET = `${BUCKET}-${APP_ID}`;
const SITE_DIR   = path.resolve(__dirname, '..');

if (!SECRET_ID || !SECRET_KEY) {
  console.error('Missing COS_SECRET_ID or COS_SECRET_KEY environment variables');
  process.exit(1);
}

const cos = new COS({ SecretId: SECRET_ID, SecretKey: SECRET_KEY });

async function setPublicRead() {
  return new Promise((resolve, reject) => {
    cos.putBucketAcl({ Bucket: FULL_BUCKET, Region: REGION, ACL: 'public-read' }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function enableStaticWebsite() {
  return new Promise((resolve, reject) => {
    cos.putBucketWebsite({
      Bucket: FULL_BUCKET,
      Region: REGION,
      WebsiteConfiguration: {
        IndexDocument: { Suffix: 'index.html' },
        ErrorDocument:  { Key: 'index.html' }
      }
    }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function collectFiles(dir, base = '') {
  const items = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === 'scripts' || name === 'node_modules') continue;
    const full = path.join(dir, name);
    const rel  = base ? `${base}/${name}` : name;
    if (fs.statSync(full).isDirectory()) {
      items.push(...collectFiles(full, rel));
    } else {
      items.push({ local: full, remote: rel });
    }
  }
  return items;
}

async function uploadFile(local, remote) {
  const ext = path.extname(remote).toLowerCase();
  const contentTypeMap = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png':  'image/png',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.webp': 'image/webp',
  };
  return new Promise((resolve, reject) => {
    cos.putObject({
      Bucket: FULL_BUCKET,
      Region: REGION,
      Key: remote,
      Body: fs.createReadStream(local),
      ContentLength: fs.statSync(local).size,
      ContentType: contentTypeMap[ext] || 'application/octet-stream',
    }, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

(async () => {
  try {
    console.log(`Bucket: ${FULL_BUCKET}`);

    console.log('Setting public-read ACL...');
    try { await setPublicRead(); } catch (e) { console.log(`ACL skipped: ${e.message}`); }

    console.log('Enabling static website hosting...');
    try { await enableStaticWebsite(); } catch (e) { console.log(`Static website skipped: ${e.message}`); }

    const files = collectFiles(SITE_DIR);
    console.log(`\nUploading ${files.length} files...\n`);

    for (const { local, remote } of files) {
      process.stdout.write(`  ↑ ${remote} ... `);
      await uploadFile(local, remote);
      console.log('done');
    }

    console.log('\nDeploy complete!');
    console.log(`http://${FULL_BUCKET}.cos-website.${REGION}.myqcloud.com`);
  } catch (err) {
    console.error('Deploy failed:', err.message || err);
    process.exit(1);
  }
})();
