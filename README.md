# Nutrient HubSpot Integration - Display Microsoft Documents, PDFs & Images

A comprehensive HubSpot private app that integrates Nutrient Document Viewer for viewing, editing, and managing PDF, Microsoft Office documents, and images directly within HubSpot CRM contact records.

> **Note:** This guide is ideal for internal tools, demos, and proof-of-concepts. With minor hardening (storage, logging, scaling), it can be production-ready.

## Features

- 📄 View PDF documents attached to contacts
- 📊 Display Microsoft Office documents (Word, Excel, PowerPoint)
- 🖼️ View images within HubSpot
- ✏️ Edit documents using Nutrient Viewer
- 💾 Save edited documents back to HubSpot
- 🔒 Secure authentication using HubSpot Private App Token
- ⚡ Time-limited viewer tokens (15-minute expiry)
- 🎯 Regex-based CORS validation

## Architecture

This solution combines a lightweight **Node.js backend**, **HubSpot's file APIs**, and the **Nutrient PDF Viewer** to create a seamless in-browser document editing experience.

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│   HubSpot CRM   │ ──────> │  Backend (Node)  │ ──────> │  HubSpot API    │
│   (Frontend)    │ <────── │  Express Server  │ <────── │  (File Access)  │
└─────────────────┘         └──────────────────┘         └─────────────────┘
         │                           │
         └──────────> Nutrient Viewer (CDN)
```

### How It Works

**HubSpot Card (nutrient-card.tsx):** This HubSpot UI Extension adds a document browser to a CRM contact record, allowing users to view and open documents associated with that contact. The extension reads the contact ID from the HubSpot context, calls a custom backend service to fetch related files, and displays them in a structured table with clear file type indicators.

**Backend (server.js):** The backend acts as a secure bridge between HubSpot and the browser. It retrieves files attached to HubSpot contacts, streams them safely to the client, and enables users to view and edit documents directly in the browser using the Nutrient SDK. When a document is opened, the backend fetches the file from HubSpot using signed URLs (ensuring private files remain secure) and sends it to the browser as binary data.

**Save Workflow:** A custom "Save to HubSpot" action is added to the viewer toolbar. With a single click, the edited document is exported from the viewer and uploaded back to HubSpot - either replacing the original file or creating a new one.

## Prerequisites

- Node.js >= 18.0.0
- HubSpot Developer Account
- HubSpot CLI installed (`npm install -g @hubspot/cli`)
- Azure Web App (or any Node.js hosting) for production
- ngrok (for local testing)
- HubSpot Private App Token

## Project Structure

```
NutrientdocsV2/
├── backend/                 # Express backend server
│   ├── server.js           # Main server file
│   ├── package.json        # Dependencies
│   ├── .env.example        # Environment template
│   ├── ENVIRONMENT_VARIABLES.md
│   └── AZURE_ENVIRONMENT_SETUP.md
├── src/
│   └── app/
│       ├── app-hsmeta.json          # App configuration
│       └── cards/
│           ├── card-hsmeta.json     # Card configuration
│           ├── nutrient-card.tsx    # Document browser card
│           └── package.json
├── hsproject.json          # HubSpot project config
├── CLAUDE.md              # HubSpot development guidelines
├── AGENTS.md
├── HUBSPOT_PROJECTS.md
└── README.md
```

## Complete Setup Guide

### Step 1: Create HubSpot Project

Create a project directory and navigate into it:

```bash
mkdir nutrient-hubspot-app
cd nutrient-hubspot-app
```

Initialize the HubSpot project:

```bash
hs project create
```

When prompted, configure as follows:
- **Project name:** Your choice
- **Project type:** App
- **Distribution:** Private
- **Authentication type:** Static Auth

Add components to your project:

```bash
hs project add
# Select: Card [card]
# Follow prompts to create the card component
```

Install dependencies:

```bash
npm install
```

Upload the project to HubSpot:

```bash
hs project upload
```

### Step 2: Configure HubSpot Private App Token

1. Go to your HubSpot account
2. Navigate to: **Settings → Integrations → Projects**
3. Click your app
4. Go to **Distribution → Standard install**
5. Click **Show** (or **Copy**) next to the Access Token
6. Save this token - you'll use it in the `.env` file

### Step 3: Update Card Configuration

Rename the default card file:

```bash
cd src/app/cards
mv NewCard.tsx nutrient-card.tsx
```

Update `card-hsmeta.json`:

```json
{
  "uid": "NutrientdocsV2_card",
  "type": "card",
  "config": {
    "name": "Nutrient HubSpot Integration",
    "location": "crm.record.tab",
    "entrypoint": "/app/cards/nutrient-card.tsx",
    "objectTypes": [
      "contacts"
    ]
  }
}
```

### Step 4: Setup Backend

From your project root, create and configure the backend:

```bash
mkdir backend
cd backend
```

Initialize Node.js project:

```bash
npm init -y
```

Install required packages:

```bash
npm install express axios cors dotenv multer @nutrient-sdk/viewer
```

**Package purposes:**
- `express` - Backend web server
- `axios` - HTTP requests to HubSpot APIs
- `cors` - Enable browser access
- `dotenv` - Environment variable management
- `multer` - Handle file uploads
- `@nutrient-sdk/viewer` - Nutrient PDF Viewer assets

Update `package.json` scripts:

```json
{
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  }
}
```

Create `.env` file (copy from `.env.example` and fill in values):

```bash
# HubSpot Configuration
HUBSPOT_PRIVATE_APP_TOKEN=your_token_here

# Server Configuration
NODE_ENV=development
PORT=3000

# Backend URL
BACKEND_URL=http://localhost:3000
```

### Step 5: Testing with ngrok

For local development and testing, use ngrok to expose your backend:

#### Install ngrok

**Windows (using Chocolatey):**
```bash
choco install ngrok
```

**Or download directly:** https://ngrok.com/download

#### Start ngrok

```bash
ngrok http 3000
```

Copy the generated HTTPS URL (e.g., `https://abc123.ngrok.io`)

#### Update Configuration with ngrok URL

1. **Update `nutrient-card.tsx`:**
   - Search for `BACKEND_URL`
   - Replace with your ngrok URL: `https://abc123.ngrok.io`

2. **Update `app-hsmeta.json`:**

```json
{
  "uid": "NutrientdocsV2_app",
  "type": "app",
  "config": {
    "description": "Nutrient Document Editor integration with secure OAuth authentication for HubSpot.",
    "name": "NutrientdocsV2-Application",
    "distribution": "private",
    "auth": {
      "type": "oauth",
      "redirectUrls": [
        "https://abc123.ngrok.io/oauth-callback"
      ],
      "requiredScopes": [
        "oauth",
        "crm.objects.contacts.read",
        "crm.objects.contacts.write",
        "files"
      ],
      "optionalScopes": [],
      "conditionallyRequiredScopes": []
    },
    "permittedUrls": {
      "fetch": [
        "https://api.hubapi.com",
        "https://abc123.ngrok.io"
      ],
      "iframe": [],
      "img": []
    },
    "support": {
      "supportEmail": "support@nutrient.io",
      "documentationUrl": "https://nutrient.io/docs",
      "supportUrl": "https://support.nutrient.io/hc/en-us/requests/new",
      "supportPhone": "+xxxxxxxxxxxxx"
    }
  }
}
```

3. **Update `.env` file:**

```bash
BACKEND_URL=https://abc123.ngrok.io
```

#### Start Development Servers

Terminal 1 - Backend:
```bash
cd backend
npm run dev
```

Terminal 2 - ngrok:
```bash
ngrok http 3000
```

Terminal 3 - HubSpot project:
```bash
cd ..
hs project upload
hs project deploy
```

#### Test the Integration

1. Open a contact record in HubSpot
2. Add the Nutrient card
3. The card should now fetch documents using your ngrok URL
4. Check the backend terminal to confirm incoming request logs
5. Click on a document to open it in the Nutrient Viewer

### Step 6: Production Deployment to Azure

Once testing is complete, deploy to Azure for production use.

#### Prerequisites
- Azure CLI installed
- Azure subscription with Web App created

#### Deployment Steps

1. **Navigate to backend directory:**

```bash
cd backend
```

2. **Install production dependencies:**

```bash
npm install --production
```

3. **Create deployment ZIP:**

**PowerShell:**
```powershell
Compress-Archive -Path * -DestinationPath deploy.zip -Force
```

**Or manually:**
- Select all files
- Right-click → Send to → Compressed folder

4. **Deploy to Azure:**

```bash
az webapp deploy --resource-group YOUR_RG --name YOUR_APP_NAME --src-path deploy.zip --type zip
```

5. **Configure Azure Environment Variables:**

In Azure Portal → App Service → Configuration → Application settings:

```
HUBSPOT_PRIVATE_APP_TOKEN=your_token_here
NODE_ENV=production
PORT=3000
BACKEND_URL=https://your-app.azurewebsites.net
```

6. **Verify deployment:**

```bash
curl https://your-app.azurewebsites.net/health
```

7. **Update HubSpot Configuration:**

Replace all ngrok URLs with your Azure URL in:
- `src/app/app-hsmeta.json` (fetch and redirectUrls)
- `src/app/cards/nutrient-card.tsx` (BACKEND_URL)

8. **Deploy to HubSpot:**

```bash
hs project upload
hs project deploy
```

## Environment Variables

### Backend (.env / Azure App Settings)

```bash
# Required
HUBSPOT_PRIVATE_APP_TOKEN=your_private_app_token

# Server Configuration
NODE_ENV=production
PORT=3000

# Backend URL (for CRM card links)
BACKEND_URL=https://your-backend.azurewebsites.net
```

## Security Features

### Authentication
- ✅ HubSpot Private App Token (via `Authorization: Bearer` header)
- ✅ No API keys exposed in frontend
- ✅ OAuth support for user-level permissions

### CORS Protection
- ✅ Regex-based origin validation
- ✅ Prevents subdomain hijacking attacks
- ✅ Validates: `hubspot.com`, `hubspotusercontent.com`, `hs-sites.com`

### Viewer Tokens
- ✅ Time-limited (15 minutes)
- ✅ File-specific validation
- ✅ Cryptographically secure (32 bytes)

### Data Security
- ✅ Files fetched using signed URLs
- ✅ Private files remain secure
- ✅ No direct file exposure to client

## API Endpoints

### Backend API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/contact-files/:contactId` | GET | Get files for contact |
| `/api/file/:fileId?token=...` | GET | Get file content |
| `/viewer/:fileId?token=...` | GET | Render document viewer |
| `/api/hubspot/upload?token=...` | POST | Upload edited document |
| `/api/crm-card` | POST | CRM card data (legacy) |

## Development Workflow

### Local Development with HubSpot Dev Server

HubSpot provides a local development server for real-time UI extension development:

```bash
hs project dev
```

Features:
- Real-time changes without refreshing
- UI extensions display "Developing locally" tag
- JSX file changes automatically refresh the page

### Local Backend Proxy

Create `src/app/local.json` to proxy backend requests during local development:

```json
{
  "proxy": {
    "https://your-production-backend.azurewebsites.net": "http://localhost:3000"
  }
}
```

**Important:**
- Proxy URLs must be valid HTTPS URLs (the key, not the value)
- Path-based routing is NOT supported
- To disable proxy, rename to `local.json.bak` and restart dev server

### Request Signing with CLIENT_SECRET

Enable request signing during local development:

```bash
CLIENT_SECRET="abc123" hs project dev
```

## Troubleshooting

### Backend Returns 503
- Check Azure App Service logs
- Verify `HUBSPOT_PRIVATE_APP_TOKEN` is set in Azure App Settings
- Ensure startup file is set to `node server.js`
- Check that all environment variables are configured

### CORS Errors
- Verify backend URL in `app-hsmeta.json` matches deployed backend
- Check Azure CORS settings (should not have wildcard `*`)
- Ensure origin matches regex pattern in backend

### Token Expired
- Tokens expire after 15 minutes
- User must click document again to generate new token
- Check backend logs for token validation errors

### ngrok Issues
- Ensure ngrok URL is updated in all configuration files
- Check that ngrok is running and not expired (free tier expires after 2 hours)
- Verify backend is running on the correct port

### HubSpot Card Not Loading
- Check browser console for errors
- Verify `permittedUrls.fetch` includes backend URL
- Ensure card is properly installed on contact record
- Check HubSpot CLI logs: `hs project logs`

### File Upload Fails
- Verify HubSpot Private App Token has `files` scope
- Check backend logs for upload errors
- Ensure file size is within limits
- Verify multipart/form-data is properly configured

## Next Steps

### For Production Deployment

1. **Get Nutrient License Key**
   - Contact: https://www.nutrient.io/contact-sales/
   - Choose between:
     - Azure deployment
     - Vercel deployment
     - Other cloud hosting

2. **Implement Production Features**
   - Add proper logging (Winston, Application Insights)
   - Implement file storage (Azure Blob Storage, AWS S3)
   - Add rate limiting and API throttling
   - Set up monitoring and alerts
   - Implement error tracking (Sentry, Rollbar)

3. **Security Hardening**
   - Rotate tokens regularly
   - Implement IP whitelisting
   - Add request signing validation
   - Enable HTTPS-only
   - Implement CSP headers

4. **Scalability Improvements**
   - Use connection pooling
   - Implement caching (Redis)
   - Add load balancing
   - Configure auto-scaling

## HubSpot CLI Commands Reference

### Project Commands
- `hs project create` - Create a new HubSpot project interactively
- `hs project upload` - Upload the project to HubSpot (build is created automatically)
- `hs project deploy` - Deploy a specific build of the project to make it live
- `hs project dev` - Start a local development server for real-time development
- `hs project watch` - Watch for file changes and automatically upload them
- `hs project list` - List all projects in the account
- `hs project logs` - View logs for deployed projects
- `hs project validate` - Validate project configuration files

### Account Management
- `hs account auth` - Authenticate a new account
- `hs account list` - List all configured accounts
- `hs account use` - Switch the default account

## Important Notes

- This is a **private app** - not for HubSpot Marketplace distribution
- Frontend uses `@hubspot/ui-extensions` components only
- `hubspot.fetch` requires fully qualified HTTPS URLs (relative paths NOT supported)
- Cannot use `window.fetch` in cards - must use `hubspot.fetch`
- All fetch URLs must be added to `permittedUrls.fetch` in `app-hsmeta.json`
- Backend uses Express.js with security middleware
- Documents are served via time-limited tokens, not direct URLs

## License

MIT

## Support

For issues or questions:
- **Backend:** Check `/health` endpoint
- **Frontend:** Check browser console for errors
- **HubSpot:** Verify app is installed and scopes are granted
- **Nutrient:** Visit https://support.nutrient.io/

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly with ngrok
5. Submit a pull request

## Resources

- [HubSpot Developer Documentation](https://developers.hubspot.com/)
- [HubSpot Projects Documentation](https://developers.hubspot.com/docs/developer-projects/overview)
- [Nutrient Documentation](https://nutrient.io/docs)
- [HubSpot CLI Documentation](https://developers.hubspot.com/docs/cms/developer-reference/local-development-cms-cli)
- [Example HubSpot Components](https://github.com/HubSpot/hubspot-project-components)

---

Built with ❤️ using HubSpot, Nutrient, and Node.js
