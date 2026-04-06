# CareConnect — Complete Deployment Checklist
# Follow every step in order. Check off as you go.

## ─────────────────────────────────────────────
## BEFORE YOU TOUCH AWS — Gather your API keys
## ─────────────────────────────────────────────

[ ] OpenAI API key
    → platform.openai.com → API Keys → Create new secret key
    → Paste into OPENAI_API_KEY in .env

[ ] SendGrid API key + verify sender email
    → app.sendgrid.com → Settings → API Keys → Create (Full Access)
    → Settings → Sender Authentication → verify your email
    → Paste into SENDGRID_API_KEY and SENDGRID_FROM_EMAIL

[ ] Twilio account + phone number
    → console.twilio.com → copy Account SID + Auth Token from homepage
    → Phone Numbers → Manage → Buy a number (pick any US number)
    → Paste all three into .env

[ ] ElevenLabs agent + phone number
    → elevenlabs.io → Profile → API Keys → copy key
    → Conversational AI → Agents → Create Agent → name it "Aria"
    → In agent settings, set system prompt (see ELEVENLABS_SETUP below)
    → Phone Numbers → Get number → attach to your agent
    → Copy Agent ID and Phone Number ID into .env

## ─────────────────────────────────────────────
## AWS SETUP
## ─────────────────────────────────────────────

[ ] Launch EC2 instance
    → AWS Console → EC2 → Launch Instance
    → OS: Ubuntu 22.04 LTS (64-bit x86)
    → Instance type: t3.small
    → Key pair: Create new → download .pem file → chmod 400 yourkey.pem
    → Security group: Allow SSH(22), HTTP(80), HTTPS(443) from 0.0.0.0/0
    → Launch → copy the Public IPv4 address

[ ] Launch RDS PostgreSQL
    → RDS → Create Database → Standard Create
    → Engine: PostgreSQL 15.x
    → Template: Free tier
    → DB instance identifier: careconnect
    → Master username: postgres
    → Master password: (save this!)
    → DB name: careconnect
    → Connectivity: same VPC as EC2
    → Public access: YES (for initial migration, disable after)
    → Create → wait 5-10 min → copy the Endpoint URL
    → Build your DATABASE_URL:
      postgresql://postgres:PASSWORD@ENDPOINT:5432/careconnect

[ ] Set up RDS security group
    → Go to the RDS instance → Connectivity & security
    → Click on the VPC security group
    → Inbound rules → Add rule: PostgreSQL (5432) from your EC2's security group
    → Also add: PostgreSQL (5432) from your laptop IP (for running migrations locally)

[ ] Point your domain to EC2
    → In your domain registrar, add an A record:
      Type: A | Name: @ (or subdomain) | Value: EC2 PUBLIC IP | TTL: 300
    → Wait 5-30 min for propagation
    → Test: ping yourdomain.com — should return EC2 IP

## ─────────────────────────────────────────────
## LOCAL SETUP — Run migrations from your laptop
## ─────────────────────────────────────────────

[ ] Install psql locally if not installed
    Mac: brew install postgresql
    Windows: download from postgresql.org

[ ] Run migration 1 (creates tables)
    psql "postgresql://postgres:PASSWORD@RDS_ENDPOINT:5432/careconnect" \
      -f migrations/001_init.sql

[ ] Run migration 2 (seeds doctors + slots)
    psql "postgresql://postgres:PASSWORD@RDS_ENDPOINT:5432/careconnect" \
      -f migrations/002_seed.sql

[ ] Verify doctors loaded correctly
    psql "postgresql://postgres:PASSWORD@RDS_ENDPOINT:5432/careconnect" \
      -c "SELECT name, specialty, array_length(body_parts,1) as keywords, \
          (SELECT COUNT(*) FROM provider_slots ps WHERE ps.provider_id=p.id) as slots \
          FROM providers p;"

    Expected output:
    Dr. Sarah Chen    | Cardiology    | 13 keywords | ~130 slots
    Dr. Marcus Webb   | Orthopedics   | 22 keywords | ~130 slots
    Dr. Priya Nair    | Dermatology   | 19 keywords | ~130 slots
    Dr. James Okafor  | Neurology     | 20 keywords | ~130 slots

## ─────────────────────────────────────────────
## DEPLOY TO EC2
## ─────────────────────────────────────────────

[ ] SSH into EC2
    ssh -i yourkey.pem ubuntu@YOUR_EC2_IP

[ ] Upload your project (from your laptop, new terminal tab)
    scp -i yourkey.pem -r ./careconnect ubuntu@YOUR_EC2_IP:/home/ubuntu/

[ ] Upload the deployment script
    scp -i yourkey.pem deploy_careconnect.sh ubuntu@YOUR_EC2_IP:/home/ubuntu/

[ ] Create .env on EC2
    nano /home/ubuntu/careconnect/.env
    (paste your complete .env file, save with Ctrl+O, Ctrl+X)

[ ] Run the deployment script
    chmod +x deploy_careconnect.sh
    ./deploy_careconnect.sh
    (follow the prompts — enter your domain name when asked)

[ ] Verify deployment
    curl https://yourdomain.com/api/health
    → should return: {"status":"ok","timestamp":"..."}

    Open https://yourdomain.com in browser
    → should see CareConnect patient chat UI

    Open https://yourdomain.com/admin
    → should see admin dashboard with 4 doctors

## ─────────────────────────────────────────────
## ELEVENLABS AGENT SETUP (do this after backend is live)
## ─────────────────────────────────────────────

[ ] In ElevenLabs dashboard → your Aria agent → Settings:

    System Prompt: (paste this)
    ---
    You are Aria, a friendly patient scheduling assistant for Greenfield Medical Practice.
    Your ONLY role is to help patients schedule appointments, check office hours/address,
    and manage their bookings. NEVER provide medical diagnoses, treatment recommendations,
    or any medical advice. If asked anything medical, say: "I'm not able to provide medical
    advice — please speak with your doctor directly."

    You may be continuing a web chat conversation. The patient's name is {{patient_name}}.
    Context from web chat: {{conversation_summary}}

    Office: 123 Wellness Drive, Suite 400, Springfield. Hours: Mon-Fri 8am-6pm. Phone: [configured OFFICE_PHONE].
    ---

[ ] Add Tools in ElevenLabs agent:

    Tool 1: get_available_slots
    → Type: Webhook
    → URL: https://yourdomain.com/api/voice/webhook/tool-call
    → Method: POST
    → Parameters: body_part (string), preferred_day (string, optional)

    Tool 2: book_appointment
    → Type: Webhook
    → URL: https://yourdomain.com/api/voice/webhook/tool-call
    → Method: POST
    → Parameters: slot_id, provider_id, patient_first_name, patient_last_name,
                  patient_dob, patient_phone, patient_email, reason, session_id

[ ] Set End-of-Call webhook
    → In agent settings → Webhooks → End of call
    → URL: https://yourdomain.com/api/voice/webhook/end-of-call

[ ] Test a call
    → In ElevenLabs dashboard → Test agent → make a test call
    → Say "I need to see someone about my knee"
    → Should match to Dr. Marcus Webb and offer slots

## ─────────────────────────────────────────────
## FINAL VERIFICATION CHECKLIST
## ─────────────────────────────────────────────

[ ] Patient chat loads at https://yourdomain.com
[ ] AI greets patient on page load
[ ] Patient can do full intake (name, DOB, phone, email, reason)
[ ] AI matches "knee pain" → Dr. Marcus Webb
[ ] AI matches "heart palpitations" → Dr. Sarah Chen
[ ] AI matches "skin rash" → Dr. Priya Nair
[ ] AI matches "migraines" → Dr. James Okafor
[ ] AI says "we don't treat that" for: "I need a dentist / eye doctor / psychiatrist"
[ ] Slot selection works
[ ] Confirmation email received after booking
[ ] SMS received if opted in
[ ] Page refresh restores conversation
[ ] "Call me instead" button triggers outbound call
[ ] Voice AI continues from where web chat left off
[ ] Admin dashboard at /admin shows all 4 doctors with slots
[ ] Admin can block/add slots and AI reflects changes immediately
[ ] Non-happy-path: AI handles no-availability gracefully

## ─────────────────────────────────────────────
## DEMO SCRIPT (for your video walkthrough)
## ─────────────────────────────────────────────

Suggested demo flow (5 min):

1. Open fresh browser window — show patient chat loading
2. Type: "Hi, I need to see a doctor about my knee"
   → AI asks for intake info
3. Fill in fake patient data quickly
4. AI presents Dr. Marcus Webb's slots
5. Ask: "Do you have anything on a Tuesday?"
   → AI filters to Tuesday slots
6. Book a slot → show confirmation email arrives
7. Go to /admin → block the slot you just booked (show change)
8. Open new incognito window → try to book same slot → show "unavailable" flow
9. Back in original window → click "Call me instead" → demo live call
10. During call: ask to reschedule → show AI has full context

Non-happy-path to demo: "I need to see an eye doctor"
→ AI should say: "We don't have an ophthalmologist on staff. I can help you with
   cardiology, orthopedics, dermatology, or neurology."
