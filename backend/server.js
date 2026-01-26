const express = require('express');
const axios = require('axios');
const cors = require('cors');
const multer = require('multer');
const FormData = require('form-data');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const corsOptions = {
  origin: function (origin, callback) {
    // Allow same-origin requests (no origin header)
    if (!origin) {
      return callback(null, true);
    }

    // Allow HubSpot domains
    if (
      origin.includes('hubspot.com') ||
      origin.includes('hubspotusercontent') ||
      origin.includes('hs-sites.com') ||
      origin.includes('hubspotpreview')
    ) {
      return callback(null, true);
    }

    // Allow our own backend domain (for viewer uploads)
    // This is needed when viewer (served from backend) makes upload requests
    if (
      origin.includes('azurewebsites.net') ||
      origin.includes('nutrient-hubspot-backend')
    ) {
      return callback(null, true);
    }

    // Allow localhost for development
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }

    // Log rejected origins for debugging
    console.warn(`CORS rejected origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Length', 'Content-Type'],
  maxAge: 86400, // Cache preflight requests for 24 hours
};

app.use(cors(corsOptions));

// Note: CORS middleware above already handles OPTIONS preflight requests for all routes

app.use(express.json());
app.use(express.raw({ type: 'application/json', limit: '50mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.hubspot.com https://*.hubspotusercontent.com https://*.hs-sites.com");
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // Additional CORS headers for upload endpoint (critical for file uploads)
  if (req.path.includes('/upload')) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  next();
});

const upload = multer({ storage: multer.memoryStorage() });

app.use('/nutrient', express.static('node_modules/@nutrient-sdk/viewer/dist'));

// =============================================================================
// SECURITY CONFIGURATION
// =============================================================================
const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;

// Validate required environment variables
if (!HUBSPOT_TOKEN) {
  console.error('ERROR: HUBSPOT_PRIVATE_APP_TOKEN is required');
  process.exit(1);
}
const viewerTokens = new Map();

/**
 * Generate a secure, time-limited viewer token for a specific file
 * @param {string} fileId - HubSpot file ID
 * @param {string} filename - Original filename
 * @returns {string} 64-character hex token
 */
function generateViewerToken(fileId, filename) {
  // Generate cryptographically random 32-byte token (64 hex chars)
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + (15 * 60 * 1000); // 15 minutes

  viewerTokens.set(token, {
    fileId,
    filename,
    expiresAt,
    used: false
  });

  // Auto-cleanup expired token after 15 minutes
  setTimeout(() => {
    viewerTokens.delete(token);
  }, 15 * 60 * 1000);

  return token;
}

/**
 * Validate viewer token and return associated data
 * @param {string} token - Token to validate
 * @returns {object|null} Token data or null if invalid/expired
 */
function validateViewerToken(token) {
  const tokenData = viewerTokens.get(token);

  if (!tokenData) {
    return null; // Token doesn't exist or already used
  }

  if (Date.now() > tokenData.expiresAt) {
    viewerTokens.delete(token);
    return null; // Token expired
  }

  return tokenData;
}

// Secure HubSpot domain validation patterns
const HUBSPOT_DOMAIN_PATTERNS = [
  /^https?:\/\/([a-z0-9-]+\.)*hubspot\.com$/i,
  /^https?:\/\/([a-z0-9-]+\.)*hubspotusercontent\.com$/i,
  /^https?:\/\/([a-z0-9-]+\.)*hs-sites\.com$/i,
  /^https?:\/\/([a-z0-9-]+\.)*hubspotpreview\.com$/i
];

function validateHubSpotRequest(req, res, next) {
  // HubSpot origin validation (primary security)
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const userAgent = req.headers['user-agent'] || '';

  // Extract domain from referer if present (referer includes full URL)
  let refererDomain = '';
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      refererDomain = `${refererUrl.protocol}//${refererUrl.host}`;
    } catch (e) {
      // Invalid referer URL
    }
  }

  // Check if origin or referer matches HubSpot domain patterns
  const isFromHubSpot =
    HUBSPOT_DOMAIN_PATTERNS.some(pattern => pattern.test(origin)) ||
    HUBSPOT_DOMAIN_PATTERNS.some(pattern => pattern.test(refererDomain)) ||
    (userAgent && /hubspot/i.test(userAgent));

  if (isFromHubSpot) {
    return next();
  }

  // Allow requests without origin/referer (e.g., server-to-server, direct access)
  // These are typically handled by other auth mechanisms (viewer tokens, etc.)
  if (!origin && !referer) {
    return next();
  }

  // Reject requests from unknown origins
  console.warn(`Rejected request from origin: ${origin || referer}`);
  return res.status(401).json({
    error: 'Unauthorized',
    message: 'Invalid authentication',
    hint: 'Requests must originate from HubSpot or include valid authentication'
  });
}

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Backend service is running',
    environment: NODE_ENV,
    security: {
      hubspotAuth: !!HUBSPOT_TOKEN
    },
    timestamp: new Date().toISOString()
  });
});

app.get('/logo.svg', (req, res) => {
  const svg = `<svg width="800" height="800" viewBox="0 0 800 800" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M212.5 437.538C191.781 437.538 175 420.757 175 400.038C175 379.319 191.781 362.538 212.5 362.538C233.219 362.538 250 379.319 250 400.038C250 420.757 233.219 437.538 212.5 437.538ZM587.5 362.538C566.781 362.538 550 379.319 550 400.038C550 420.757 566.781 437.538 587.5 437.538C608.219 437.538 625 420.757 625 400.038C625 379.319 608.219 362.538 587.5 362.538ZM232.263 491.838C216.4 505.151 214.319 528.813 227.631 544.676C240.944 560.538 264.606 562.619 280.469 549.307C296.331 535.994 298.413 512.332 285.1 496.469C271.788 480.607 248.125 478.526 232.263 491.838ZM567.738 308.238C583.6 294.926 585.681 271.263 572.369 255.401C559.056 239.538 535.394 237.457 519.531 250.769C503.669 264.082 501.587 287.744 514.9 303.607C528.212 319.469 551.875 321.551 567.738 308.238ZM280.469 250.788C264.606 237.476 240.944 239.538 227.631 255.419C214.319 271.301 216.381 294.944 232.263 308.257C248.144 321.569 271.788 319.507 285.1 303.626C298.413 287.744 296.35 264.101 280.469 250.788ZM567.738 491.838C551.875 478.526 528.212 480.588 514.9 496.469C501.587 512.332 503.65 535.994 519.531 549.307C535.394 562.619 559.056 560.557 572.369 544.676C585.681 528.813 583.619 505.151 567.738 491.838ZM471.981 411.476C456.119 398.163 432.456 400.226 419.144 416.107C405.831 431.988 407.894 455.632 423.775 468.944C439.656 482.257 463.3 480.194 476.613 464.313C489.925 448.432 487.862 424.788 471.981 411.476ZM376.225 331.132C360.362 317.819 336.7 319.882 323.387 335.763C310.075 351.644 312.138 375.288 328.019 388.601C343.9 401.913 367.544 399.851 380.856 383.969C394.169 368.088 392.106 344.444 376.225 331.132Z" fill="#0B5FFF"/>
</svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  res.send(svg);
});

app.get('/oauth-callback', async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>OAuth Error</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: #f5f5f5;
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            max-width: 500px;
            text-align: center;
          }
          h1 { color: #d32f2f; margin-bottom: 16px; }
          p { color: #666; line-height: 1.6; }
          .error-code {
            background: #ffebee;
            padding: 12px;
            border-radius: 4px;
            margin: 16px 0;
            font-family: monospace;
            color: #c62828;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>OAuth Error</h1>
          <p>There was an error during the OAuth authorization process.</p>
          <div class="error-code">
            <strong>Error:</strong> ${error}<br>
            ${error_description ? `<strong>Details:</strong> ${error_description}` : ''}
          </div>
          <p>Please try installing the app again or contact support if the issue persists.</p>
        </div>
      </body>
      </html>
    `);
  }

  if (!code) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Invalid Request</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: #f5f5f5;
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            max-width: 500px;
            text-align: center;
          }
          h1 { color: #d32f2f; }
          p { color: #666; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Invalid Request</h1>
          <p>No authorization code was provided. This endpoint is used for OAuth callbacks from HubSpot.</p>
        </div>
      </body>
      </html>
    `);
  }

  try {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Installation Successful</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          }
          .container {
            background: white;
            padding: 48px;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
            max-width: 500px;
            text-align: center;
          }
          h1 {
            color: #2e7d32;
            margin-bottom: 16px;
            font-size: 32px;
          }
          .checkmark {
            font-size: 64px;
            margin-bottom: 24px;
          }
          p {
            color: #666;
            line-height: 1.8;
            margin-bottom: 12px;
          }
          .success-box {
            background: #e8f5e9;
            padding: 16px;
            border-radius: 6px;
            margin: 24px 0;
            border-left: 4px solid #2e7d32;
          }
          .next-steps {
            text-align: left;
            margin-top: 24px;
            padding: 16px;
            background: #f5f5f5;
            border-radius: 6px;
          }
          .next-steps h3 {
            margin-top: 0;
            color: #333;
          }
          .next-steps ol {
            margin: 8px 0;
            padding-left: 20px;
          }
          .next-steps li {
            margin: 8px 0;
            color: #666;
          }
          .close-btn {
            margin-top: 24px;
            padding: 12px 32px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 16px;
            cursor: pointer;
            transition: background 0.2s;
          }
          .close-btn:hover {
            background: #5568d3;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="checkmark">Checked</div>
          <h1>Installation Successful!</h1>

          <div class="success-box">
            <strong>Nutrient HubSpot Integration</strong><br>
            The app has been successfully authorized and installed.
          </div>

          <p>Your HubSpot account is now connected to the Nutrient Document Editor.</p>

          <div class="next-steps">
            <h3>Next Steps:</h3>
            <ol>
              <li>Navigate to any Contact record in HubSpot</li>
              <li>Look for the "Nutrient Document Editor" card</li>
              <li>Attach PDF files to contact notes to view them in the card</li>
              <li>Click on any document to view and edit with Nutrient</li>
            </ol>
          </div>

          <button class="close-btn" onclick="window.close()">Close Window</button>
        </div>

        <script>
          if (window.opener) {
            setTimeout(() => {
              window.close();
            }, 5000);
          }
        </script>
      </body>
      </html>
    `);

  } catch (error) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Installation Error</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: #f5f5f5;
          }
          .container {
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            max-width: 500px;
            text-align: center;
          }
          h1 { color: #d32f2f; }
          p { color: #666; line-height: 1.6; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Installation Error</h1>
          <p>There was an error completing the installation. Please try again or contact support.</p>
          <p style="font-size: 14px; color: #999; margin-top: 24px;">Error: ${error.message}</p>
        </div>
      </body>
      </html>
    `);
  }
});

app.post('/api/generate-viewer-token', validateHubSpotRequest, async (req, res) => {
  try {
    const { fileId, filename } = req.body;

    if (!fileId) {
      return res.status(400).json({
        success: false,
        error: 'Missing fileId'
      });
    }

    const token = generateViewerToken(fileId, filename || 'document');

    res.json({
      success: true,
      token,
      expiresIn: 900
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


app.get('/api/contact-files/:contactId', validateHubSpotRequest, async (req, res) => {
  const { contactId } = req.params;

  try {
    const notesResponse = await axios.get(
      `https://api.hubapi.com/crm/v4/objects/contacts/${contactId}/associations/notes`,
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!notesResponse.data.results || notesResponse.data.results.length === 0) {
      return res.json({ files: [] });
    }

    const allFiles = [];

    for (const note of notesResponse.data.results) {
      try {
        const noteDetailsResponse = await axios.get(
          `https://api.hubapi.com/crm/v3/objects/notes/${note.toObjectId}?properties=hs_attachment_ids`,
          {
            headers: {
              Authorization: `Bearer ${HUBSPOT_TOKEN}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const attachmentIds = noteDetailsResponse.data.properties?.hs_attachment_ids;

        if (attachmentIds) {
          const fileIds = attachmentIds.split(';').filter(id => id.trim());

          for (const fileId of fileIds) {
            try {
              const fileResponse = await axios.get(
                `https://api.hubapi.com/files/v3/files/${fileId.trim()}`,
                {
                  headers: {
                    Authorization: `Bearer ${HUBSPOT_TOKEN}`,
                    'Content-Type': 'application/json'
                  }
                }
              );

              const fileData = fileResponse.data;
              const viewerToken = generateViewerToken(fileData.id, fileData.name);

              allFiles.push({
                id: fileData.id,
                name: fileData.name,
                extension: fileData.extension || 'unknown',
                url: fileData.url,
                size: fileData.size,
                viewerToken: viewerToken // [SECURE] Time-limited token for file access
              });
            } catch (fileError) {
              // error ignored
            }
          }
        }
      } catch (noteError) {
        // error ignored
      }
    }

    res.json({
      success: true,
      contactId,
      fileCount: allFiles.length,
      files: allFiles
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || null
    });
  }
});


app.get('/api/file/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const token = req.query.token;

  // Require valid viewer token
  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Missing authentication token',
      hint: 'Get a viewer token from /api/contact-files/:contactId'
    });
  }

  // Validate token and ensure it matches the requested fileId
  const tokenData = validateViewerToken(token);
  if (!tokenData || tokenData.fileId !== fileId) {
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired token',
      hint: 'Tokens expire after 15 minutes. Request a new token from the contact files endpoint.'
    });
  }

  try {
    const fileResponse = await axios.get(
      `https://api.hubapi.com/files/v3/files/${fileId}`,
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const fileData = fileResponse.data;
    const signedUrlEndpoint = `https://api.hubapi.com/files/v3/files/${fileId}/signed-url`;

    const signedUrlResponse = await axios.get(signedUrlEndpoint, {
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const signedUrl = signedUrlResponse.data.url;

    const fileContentResponse = await axios.get(signedUrl, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'HubSpot-File-Service/1.0'
      }
    });

    const contentStart = Buffer.from(fileContentResponse.data).toString('utf8', 0, 100);
    if (contentStart.includes('<!DOCTYPE') || contentStart.includes('<html')) {
      throw new Error('Received HTML instead of file content from HubSpot');
    }

    const mimeTypes = {
      'pdf': 'application/pdf',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'txt': 'text/plain',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };

    const extension = fileData.extension?.toLowerCase() || 'bin';
    const mimeType = mimeTypes[extension] || 'application/octet-stream';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${fileData.name}"`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(fileContentResponse.data);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/viewer/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const filename = req.query.filename || 'document';
  const token = req.query.token;

  // Require valid viewer token
  if (!token) {
    return res.status(401).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Unauthorized</title></head>
      <body>
        <h1>Unauthorized</h1>
        <p>Missing authentication token. Please access this page from HubSpot.</p>
        <p style="color: #666; font-size: 14px;">Security: This viewer requires a time-limited access token.</p>
      </body>
      </html>
    `);
  }

  // Validate token matches the requested file
  const tokenData = validateViewerToken(token);
  if (!tokenData || tokenData.fileId !== fileId) {
    return res.status(401).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Unauthorized</title></head>
      <body>
        <h1>Unauthorized</h1>
        <p>Invalid or expired token. Tokens are valid for 15 minutes.</p>
        <p style="color: #666; font-size: 14px;">Please return to HubSpot and click the document link again to generate a new token.</p>
      </body>
      </html>
    `);
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nutrient Viewer - ${filename}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; background: #f5f5f5; }
    #header { background: #fff; padding: 16px 24px; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center; }
    #header h1 { font-size: 18px; font-weight: 600; color: #333; }
    #container { width: 100vw; height: calc(100vh - 60px); }
    #loading { display: flex; align-items: center; justify-content: center; height: 100%; font-size: 16px; color: #666; }
    .error { color: #d32f2f; padding: 24px; text-align: center; }
  </style>
</head>
<body>
  <div id="header">
    <h1>${filename}</h1>
    <button onclick="window.close()" style="padding: 8px 16px; cursor: pointer; border: 1px solid #ccc; background: #fff; border-radius: 4px;">Close</button>
  </div>
  <div id="container">
    <div id="loading">Loading document...</div>
  </div>

  <script src="https://cdn.cloud.pspdfkit.com/pspdfkit-web@1.10.0/nutrient-viewer.js"></script>
  <script>
    const container = document.getElementById('container');
    const loading = document.getElementById('loading');

    async function loadDocument() {
      try {
        loading.innerHTML = 'Fetching document from backend...';

        const fileUrl = window.location.origin + '/api/file/${fileId}?token=${token}';
        const response = await fetch(fileUrl);

        if (!response.ok) {
          throw new Error(\`Failed to fetch document: \${response.status} \${response.statusText}\`);
        }

        const arrayBuffer = await response.arrayBuffer();
        container.innerHTML = '';

        const saveToHubSpotButton = {
          type: 'custom',
          id: 'save-to-hubspot',
          title: 'Save to HubSpot',
          className: 'save-to-hubspot-button',
          onPress: async function() {
            try {
              // Show loading indicator
              const saveBtn = document.querySelector('.save-to-hubspot-button');
              if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.textContent = 'Saving...';
              }

              // Export PDF from Nutrient viewer
              const pdfBuffer = await instance.exportPDF();
              const formData = new FormData();
              const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
              formData.append('file', blob, '${filename}');
              formData.append('filename', '${filename}');
              formData.append('fileId', '${fileId}');

              // Upload to backend with token
              const backendUrl = window.location.origin + '/api/hubspot/upload?token=${token}';
              const uploadResponse = await fetch(backendUrl, {
                method: 'POST',
                body: formData
              });

              // Parse response (should always be JSON)
              let result;
              try {
                result = await uploadResponse.json();
              } catch (parseError) {
                throw new Error('Server returned invalid response. Expected JSON but got: ' + parseError.message);
              }

              // Check if upload was successful
              if (!uploadResponse.ok || !result.success) {
                throw new Error(result.error || result.hint || 'Upload failed with status ' + uploadResponse.status);
              }

              // Show success message
              if (saveBtn) {
                saveBtn.textContent = '✓ Saved!';
                saveBtn.style.background = '#28a745';
                setTimeout(() => {
                  saveBtn.disabled = false;
                  saveBtn.textContent = 'Save to HubSpot';
                  saveBtn.style.background = '';
                }, 3000);
              }

              alert('✓ Document saved successfully to HubSpot!\\n\\n' + (result.message || 'File updated.'));

            } catch (error) {
              // Re-enable button on error
              const saveBtn = document.querySelector('.save-to-hubspot-button');
              if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save to HubSpot';
              }

              // Show detailed error message
              alert('Failed to save to HubSpot:\\n\\n' + error.message + '\\n\\nPlease check:\\n- Token may have expired (15 min limit)\\n- Backend logs for details\\n- Network connectivity');
            }
          }
        };

        const items = NutrientViewer.defaultToolbarItems;
        items.push(saveToHubSpotButton);

        const instance = await NutrientViewer.load({
          container,
          document: arrayBuffer,
          baseUrl: 'https://cdn.cloud.pspdfkit.com/pspdfkit-web@1.10.0/',
          toolbarItems: items
        });
      } catch (error) {
        loading.innerHTML = '<div class="error">Failed to load document: ' + error.message + '</div>';
      }
    }
    loadDocument();
  </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});



app.post('/api/hubspot/upload', upload.single('file'), async (req, res) => {
  // CRITICAL: Set CORS headers explicitly for upload endpoint
  // This ensures requests from viewer (in iframe) are allowed
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }

  // CRITICAL: Always return JSON, never HTML
  // This ensures frontend can properly parse error responses
  try {
    const token = req.query.token;

    // Validate token presence
    if (!token) {
      console.warn('Upload attempt without token');
      return res.status(401).json({
        success: false,
        error: 'Missing authentication token',
        hint: 'Token must be provided in query parameter'
      });
    }

    // Validate token is valid and not expired
    const tokenData = validateViewerToken(token);
    if (!tokenData) {
      console.warn('Upload attempt with invalid/expired token');
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token',
        hint: 'Token has expired (15 min limit) or is invalid. Return to HubSpot to generate a new token.'
      });
    }

    const file = req.file;
    const { filename, fileId } = req.body;

    // Validate file was uploaded
    if (!file) {
      console.error('Upload failed: No file in request');
      return res.status(400).json({
        success: false,
        error: 'No file provided',
        hint: 'File must be uploaded as multipart/form-data with field name "file"'
      });
    }

    // Validate file buffer exists
    if (!file.buffer) {
      console.error('Upload failed: File has no buffer');
      return res.status(400).json({
        success: false,
        error: 'File buffer is empty',
        hint: 'The uploaded file appears to be empty or corrupted'
      });
    }

    // If fileId is provided, replace existing file in HubSpot
    if (fileId) {
      const formData = new FormData();
      formData.append('file', file.buffer, {
        filename: filename || file.originalname,
        contentType: file.mimetype || 'application/pdf',
      });

      const optionsJson = JSON.stringify({
        access: 'PUBLIC_NOT_INDEXABLE'
      });
      formData.append('options', optionsJson);

      try {
        const hubspotResponse = await axios.post(
          `https://api.hubapi.com/filemanager/api/v3/files/${fileId}/replace`,
          formData,
          {
            headers: {
              ...formData.getHeaders(),
              Authorization: `Bearer ${HUBSPOT_TOKEN}`,
            },
          }
        );

        const fileInfo = hubspotResponse.data;

        return res.json({
          success: true,
          updated: true,
          message: 'File replaced successfully in HubSpot',
          file: {
            id: fileInfo.id,
            name: fileInfo.name,
            url: fileInfo.url,
            size: fileInfo.size,
            extension: fileInfo.extension
          }
        });
      } catch (replaceError) {
        console.error('HubSpot file replace failed:', replaceError.message);
        if (replaceError.response?.data) {
          console.error('Details:', replaceError.response.data);
        }
        throw replaceError;
      }
    } else {
      // If no fileId, create new file in HubSpot

      const formData = new FormData();
      formData.append('file', file.buffer, {
        filename: filename || file.originalname,
        contentType: file.mimetype || 'application/pdf',
      });

      formData.append('folderPath', '/nutrient-edited-files');

      const optionsJson = JSON.stringify({
        access: 'HIDDEN_PRIVATE',
        overwrite: false
      });

      formData.append('options', optionsJson);

      const hubspotResponse = await axios.post(
        'https://api.hubapi.com/filemanager/api/v3/files/upload',
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          },
        }
      );

      const fileInfo = hubspotResponse.data;

      return res.json({
        success: true,
        updated: false,
        message: 'New file uploaded successfully to HubSpot',
        file: {
          id: fileInfo.id,
          name: fileInfo.name,
          url: fileInfo.url,
          size: fileInfo.size,
          extension: fileInfo.extension
        }
      });
    }

  } catch (error) {
    // CRITICAL: Always return JSON response, never HTML
    // This ensures the frontend can parse the error properly
    console.error('Upload endpoint error:', error.message);

    // Detailed error logging for debugging
    if (error.response) {
      console.error('HubSpot API error response:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    }

    // Return user-friendly error message
    return res.status(500).json({
      success: false,
      error: error.message || 'Upload failed',
      details: error.response?.data || null,
      hint: 'Check backend logs for detailed error information'
    });
  }
});

app.post('/api/crm-card', async (req, res) => {
  try {
    const { hs_object_id } = req.body;
    const contactId = hs_object_id || req.body.objectId;

    if (!contactId) {
      return res.json({
        results: [{
          objectId: 0,
          title: "No Contact ID",
          properties: []
        }]
      });
    }

    const response = await axios.get(
      `https://api.hubapi.com/files/v3/files/search`,
      {
        params: {
          properties: 'id,name,extension,url,size'
        },
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const allFiles = response.data.results || [];

    const contactFiles = allFiles.filter(f =>
      f.name && (f.extension === 'pdf' || f.extension === 'PDF')
    ).slice(0, 10);

    const cardData = {
      results: [{
        objectId: parseInt(contactId),
        title: `${contactFiles.length} Document${contactFiles.length !== 1 ? 's' : ''}`,
        properties: contactFiles.length > 0 ?
          contactFiles.map(file => ({
            label: file.name,
            dataType: "STRING",
            value: file.name
          })) :
          [{
            label: "No documents",
            dataType: "STRING",
            value: "No PDF files found"
          }],
        actions: contactFiles.map(file => {
          const viewerToken = generateViewerToken(file.id, file.name);
          return {
            type: "IFRAME",
            width: 1200,
            height: 800,
            uri: `https://nutrient-hubspot-backend.azurewebsites.net/viewer/${file.id}?filename=${encodeURIComponent(file.name)}&token=${viewerToken}`,
            label: `View ${file.name}`,
            associatedObjectProperties: []
          };
        })
      }]
    };

    res.json(cardData);

  } catch (error) {
    res.json({
      results: [{
        objectId: 0,
        title: "Error Loading Documents",
        properties: [{
          label: "Error",
          dataType: "STRING",
          value: error.message
        }]
      }]
    });
  }
});
app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Security: CORS enabled, HubSpot Auth: ${!!HUBSPOT_TOKEN}`);
});