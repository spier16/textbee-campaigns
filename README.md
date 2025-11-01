# textbee.dev - android sms gateway

textbee.dev is an open-source SMS gateway that enables users to send and receive SMS messages via a web dashboard or a REST API. Perfect for businesses, developers, and hobbyists who need a reliable and cost-effective way to automate SMS messaging.

- **Technology stack**: React, Next.js, Node.js, NestJs, MongoDB, Android, Java
- **Link**: [https://textbee.dev](https://textbee.dev/)

![](https://ik.imagekit.io/vernu/textbee/textbee.dev-landingpage-screenshot.png?updatedAt=1749102564772)


## Features

- Send & receive SMS messages via API & dashboard
- Use your own Android phone as an SMS gateway
- REST API for easy integration with apps & services
- Send Bulk SMS with CSV file
- Multi-device support for higher SMS throughput
- Secure API authentication with API keys
- Webhook support
- Self-hosting support for full control over your data




## Getting Started

1. Go to [textbee.dev](https://textbee.dev) and register or login with your account
2. Install the app on your android phone from [textbee.dev/download](https://textbee.dev/download)
3. Open the app and grant the permissions for SMS
4. Go to [textbee.dev/dashboard](https://textbee.dev/dashboard) and click register device/ generate API Key
5. Scan the QR code with the app or enter the API key manually
6. You are ready to send SMS messages from the dashboard or from your application via the REST API

**Code Snippet**: Few lines of code showing how to send an SMS message via the REST API

```javascript
const API_KEY = 'YOUR_API_KEY';
const DEVICE_ID = 'YOUR_DEVICE_ID';

await axios.post(`https://api.textbee.dev/api/v1/gateway/devices/${DEVICE_ID}/send-sms`, {
  recipients: [ '+251912345678' ],
  message: 'Hello World!',
}, {
  headers: {
    'x-api-key': API_KEY,
  },
});

```

**Code Snippet**: Curl command to send an SMS message via the REST API

```bash
curl -X POST "https://api.textbee.dev/api/v1/gateway/devices/YOUR_DEVICE_ID/send-sms" \
  -H 'x-api-key: YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  -d '{
    "recipients": [ "+251912345678" ],
    "message": "Hello World!"
  }'
```

### Receiving SMS Messages

To receive SMS messages, you can enable the feature from the mobile app. You can then fetch the received SMS messages via the REST API or view them in the dashboard. (Webhook notifications are coming soon)

**Code Snippet**: Few lines of code showing how to fetch received SMS messages via the REST API

```javascript
const API_KEY = 'YOUR_API_KEY';
const DEVICE_ID = 'YOUR_DEVICE_ID';

await axios.get(`https://api.textbee.dev/api/v1/gateway/devices/${DEVICE_ID}/get-received-sms`, {
  headers: {
    'x-api-key': API_KEY,
  },
});

```

**Code Snippet**: Curl command to fetch received SMS messages

```bash
curl -X GET "https://api.textbee.dev/api/v1/gateway/devices/YOUR_DEVICE_ID/get-received-sms"\
  -H "x-api-key: YOUR_API_KEY"
```

## Self-Hosting

### Setting Up Database

1. **Install MongoDB on Your Server**: Follow the official MongoDB installation guide for your operating system.
2. **Using MongoDB Atlas**: Alternatively, you can create a free database on MongoDB Atlas. Sign up at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) and follow the instructions to set up your database.

### Firebase Setup

1. Create a Firebase project.
2. Enable Firebase Cloud Messaging (FCM) in your Firebase project.
3. Obtain the Firebase credentials for backend use and the Android app.

### Building the Android App

1. Clone the repository and navigate to the Android project directory.
2. Update the `google-services.json` file with your Firebase project configuration.
3. Update every occurrence of `textbee.dev` with your own domain in the project.
4. Build the app using Android Studio or the command line:
   ```bash
   ./gradlew assembleRelease
   ```

### Building the Web

1. Navigate to the `web` directory.
2. Copy the `.env.example` file to `.env`:
   ```bash
   cp .env.example .env
   ```
3. Update the `.env` file with your own credentials.
4. Install dependencies:
   ```bash
   pnpm install
   ```
5. Build the web application:
   ```bash
   pnpm build
   ```

### Building the API

1. Navigate to the `api` directory.
2. Copy the `.env.example` file to `.env`:
   ```bash
   cp .env.example .env
   ```
3. Update the `.env` file with your own credentials.
4. Install dependencies:
   ```bash
   pnpm install
   ```
5. Build the API:
   ```bash
   pnpm build
   ```

### Hosting on a VPS

1. Install `pnpm`, `pm2`, and `Caddy` on your VPS.
2. Use `pm2` to manage your Node.js processes:
   ```bash
   pm2 start dist/main.js --name textbee-api
   ```
3. Configure `Caddy` to serve your web application and API. Example Caddyfile:
   ```
   textbee.dev {
       reverse_proxy /api/* localhost:3000
       reverse_proxy /* localhost:3001
   }
   ```
4. Ensure your domain points to your VPS and Caddy is configured properly.

### Dockerized Deployment

#### Option 1: Build Locally (Recommended for Low-Memory VPS)

This approach builds Docker images on your local machine and pushes them to GitHub Container Registry, then pulls them on your VPS. This is ideal for VPS instances with limited RAM (< 4GB) that struggle with building Next.js applications.

##### Requirements:
- Docker installed on both local machine and VPS
- GitHub account with Container Registry access

##### Setup GitHub Container Registry

1. **Create a GitHub Personal Access Token**:
   - Go to https://github.com/settings/tokens/new
   - Note: "Docker registry access"
   - Select scopes: `write:packages`, `read:packages`
   - Generate token and save it securely

2. **Login to GHCR on your local machine**:
   ```bash
   echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
   ```

3. **Make your packages public** (optional, to avoid login on VPS):
   - Go to https://github.com/YOUR_USERNAME?tab=packages
   - Click on each package (`textbee-web`, `textbee-api`)
   - Click "Package settings" → "Change visibility" → "Public"

##### Build and Deploy Workflow

**On your local machine:**

1. After setting up Firebase, update your `.env` files:
   ```bash
   cd web && cp .env.example .env.production && cd ..
   cd api && cp .env.example .env.production && cd ..
   ```

2. Build the Android production APK:
   ```bash
   cd android
   # For signed release (requires keystore):
   ./gradlew assembleProdRelease

   # OR for debug build (no keystore needed):
   ./gradlew assembleProdDebug
   cd ..
   ```

3. Copy the APK to the web folder:
   ```bash
   cd web
   # For release build:
   npm run copy-apk:prod

   # OR for debug build:
   npm run copy-apk:prod-debug
   cd ..
   ```

4. Build and push Docker images:
   ```bash
   # Build images
   docker build -t ghcr.io/YOUR_GITHUB_USERNAME/textbee-api:latest ./api
   docker build -t ghcr.io/YOUR_GITHUB_USERNAME/textbee-web:latest ./web

   # Push to GitHub Container Registry
   docker push ghcr.io/YOUR_GITHUB_USERNAME/textbee-api:latest
   docker push ghcr.io/YOUR_GITHUB_USERNAME/textbee-web:latest
   ```

**On your VPS:**

1. Update `docker-compose.prebuilt.yaml` with your GitHub username (if not already done).

2. Login to GHCR (only needed if packages are private):
   ```bash
   echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
   ```

3. Pull and run the containers:
   ```bash
   docker compose -f docker-compose.prebuilt.yaml pull
   docker compose -f docker-compose.prebuilt.yaml up -d
   ```

4. To stop containers:
   ```bash
   docker compose -f docker-compose.prebuilt.yaml down
   ```

##### Updating Your Deployment

When you make changes and need to redeploy:

**Local machine:**
```bash
# Rebuild APK if Android code changed
cd android && ./gradlew assembleProdDebug && cd ..

# Copy APK
cd web && npm run copy-apk:prod-debug && cd ..

# Rebuild and push images
docker build -t ghcr.io/YOUR_GITHUB_USERNAME/textbee-web:latest ./web
docker push ghcr.io/YOUR_GITHUB_USERNAME/textbee-web:latest

# If API changed:
docker build -t ghcr.io/YOUR_GITHUB_USERNAME/textbee-api:latest ./api
docker push ghcr.io/YOUR_GITHUB_USERNAME/textbee-api:latest
```

**VPS:**
```bash
docker compose -f docker-compose.prebuilt.yaml pull
docker compose -f docker-compose.prebuilt.yaml up -d
```

#### Option 2: Build on VPS (Requires 4GB+ RAM)

If your VPS has sufficient memory (4GB+ RAM), you can build directly on the server:

1. After setting up Firebase, update your `.env` files:
   ```bash
   cd web && cp .env.example .env.production && cd ..
   cd api && cp .env.example .env.production && cd ..
   ```

2. Build the Android production APK:
   ```bash
   cd android
   ./gradlew assembleProdRelease
   cd ..
   ```

3. Copy APK to web folder:
   ```bash
   cd web && npm run copy-apk:prod && cd ..
   ```

4. Build and start containers:
   ```bash
   docker compose build
   docker compose up -d
   ```

5. To stop containers:
   ```bash
   docker compose down
   ```

This will spin up `web` container, `api` container alongside with `MongoDB` and `MongoExpress`. `TextBee` database will be automatically created.

#### Important Notes

- **Keystore Security**: Never commit `*.keystore` or `*.jks` files to git. They are in `.gitignore` for security.
- **APK in Docker**: The APK must be copied to `web/public/textbee.apk` before building the Docker image, as it gets included in the build.
- **Memory Issues**: If builds fail with "JavaScript heap out of memory", use Option 1 (build locally) or upgrade your VPS RAM.
- **Environment Files**: Keep `.env.production` files out of git. They contain sensitive credentials.   

## Contributing

Contributions are welcome!

1. [Fork](https://github.com/vernu/textbee/fork) the project.
2. Create a feature or bugfix branch from `main` branch.
3. Make sure your commit messages and PR comment summaries are descriptive.
4. Create a pull request to the `main` branch.

## Bug Reporting and Feature Requests

Please feel free to [create an issue](https://github.com/vernu/textbee/issues/new) in the repository for any bug reports or feature requests. Make sure to provide a detailed description of the issue or feature you are requesting and properly label whether it is a bug or a feature request.

Please note that if you discover any vulnerability or security issue, we kindly request that you refrain from creating a public issue. Instead, send an email detailing the vulnerability to contact@textbee.dev.

## For support, feedback, and questions
Feel free to reach out to us at contact@textbee.dev or [Join our Discord server](https://discord.gg/d7vyfBpWbQ)
