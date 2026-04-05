# CareConnect

CareConnect is a full-stack medical patient scheduling app with a React frontend, Express API, PostgreSQL persistence, OpenAI-powered chat scheduling, SMS and email communications, and an admin dashboard for live scheduling control.

## Tech Stack

- Frontend: React + Vite + Tailwind CSS
- Backend: Node.js + Express
- Database: PostgreSQL with `pg`
- AI: OpenAI `gpt-4o`
- Communications: SendGrid, Twilio, ElevenLabs
- Process management: PM2
- Reverse proxy / TLS: Nginx + Certbot

## Local Dev Setup

1. Copy [.env.example](./.env.example) to `.env` and fill in your credentials.
2. Install dependencies:

```bash
npm install
```

3. Run the database migrations:

```bash
npm run migrate
```

4. Start the app in development:

```bash
npm run dev
```

5. Open the frontend at `http://localhost:5173` and the API at `http://localhost:3001`.

## EC2 Deployment Steps

1. Launch an Ubuntu EC2 instance and point your domain DNS to the instance.
2. SSH into the instance and clone this repository.
3. Run [scripts/setup-ec2.sh](./scripts/setup-ec2.sh) to install Node 20, Nginx, PM2, Certbot, and PostgreSQL client tools.
4. Copy [nginx/careconnect.conf](./nginx/careconnect.conf) into `/etc/nginx/sites-available/careconnect` and symlink it into `/etc/nginx/sites-enabled/`.
5. Update the placeholder domain and SSL certificate paths in the Nginx config.
6. Request an HTTPS certificate:

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

7. Create and populate your production `.env` file, including `FRONTEND_URL=https://yourdomain.com`.
8. Run the migrations against the production database:

```bash
npm run migrate
```

9. Deploy the app:

```bash
bash scripts/deploy.sh
```

10. Save the PM2 process list if needed:

```bash
pm2 save
```

## Environment Variables

- `DATABASE_URL`: PostgreSQL connection string
- `OPENAI_API_KEY`: OpenAI API key for Aria chat
- `SENDGRID_API_KEY`: SendGrid API key for email delivery
- `SENDGRID_FROM_EMAIL`: Verified SendGrid sender
- `TWILIO_ACCOUNT_SID`: Twilio account SID
- `TWILIO_AUTH_TOKEN`: Twilio auth token
- `TWILIO_PHONE_NUMBER`: Twilio sender phone number
- `ELEVENLABS_API_KEY`: ElevenLabs API key
- `ELEVENLABS_AGENT_ID`: ElevenLabs Conversational AI agent ID
- `ELEVENLABS_PHONE_NUMBER_ID`: ElevenLabs outbound number ID
- `FRONTEND_URL`: Allowed frontend origin for CORS
- `CRON_ENABLED`: Enables or disables reminder cron jobs
- `SESSION_SECRET`: Reserved for future auth/session work
- `PORT`: Express server port

## Links

- Live App URL: `https://yourdomain.com`
- GitHub Repo: `https://github.com/your-org/careconnect`
