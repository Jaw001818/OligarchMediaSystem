# 🏢 Oligarch Media — HR, Attendance & Payroll Management System

A high-performance, responsive HR, Attendance, and Payroll Management platform built for **Oligarch Media Graphic Design Studio**.

Powered by **React**, **Vite**, **Tailwind CSS v4**, and **Firebase Cloud Firestore**.

---

## ⚡ Key Capabilities
- **Real-Time Cloud Persistence**: Backed by Firebase Cloud Firestore (`spherical-program-f3n78`), with bi-directional syncing, instant updates across tabs/devices, and offline fallback.
- **Attendance & Time Tracking**: Live clock-in/out, multi-shift scheduling, automated night differential (10%), overtime (125%), late tracking with grace periods, and break management.
- **Automated Payroll Engine**: Cutoff calculations (1-15 & 16-EOM), Boss Plus/Cash additions, Cash Advance installment deductions, 13th-month annual reckonings, and downloadable PDF pay ledgers.
- **Employee Portal**: Dedicated zero-password portal with PIN validation and instant account lockouts for Inactive/Resigned staff.
- **Automated Payslip Email Dispatch**: Direct delivery of official HTML payslips via Gmail OAuth API or SMTP nodemailer carrier.

---

## 🚀 How to Upload to GitHub & Deploy for FREE

### Step 1: Uploading to GitHub
1. Create a new repository on [GitHub](https://github.com/new) (e.g., `oligarch-media-payroll`).
2. In your local terminal inside this project folder:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - Oligarch Media HR & Payroll"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/oligarch-media-payroll.git
   git push -u origin main
   ```

---

### Step 2: Deploy for 100% FREE

You can deploy this application for free using any of these top platforms:

#### 🌟 Option A: Vercel (Recommended — 2 Minutes, Zero Setup)
1. Sign in to [Vercel](https://vercel.com) with your GitHub account.
2. Click **"Add New"** > **"Project"** and select your GitHub repository.
3. Vercel will automatically detect **Vite**:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Click **"Deploy"**.
5. **Done!** Your live app URL (e.g., `https://oligarch-media.vercel.app`) is live.
   * *Cloud Firestore database saves and persists automatically because `firebase-applet-config.json` is bundled directly.*

#### 🌟 Option B: Netlify (Alternative Free Frontend Host)
1. Sign in to [Netlify](https://www.netlify.com) using GitHub.
2. Click **"Add new site"** > **"Import an existing project"**.
3. Select your repository.
4. Set:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
5. Click **"Deploy site"**.

#### 🌟 Option C: Render / Railway (For Full-Stack Server with SMTP Backend)
If you want the Node.js Express email backend running in the cloud for free:
1. Go to [Render.com](https://render.com) and create a **Web Service**.
2. Connect your GitHub repository.
3. Configure:
   - **Environment**: Node
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
4. In Environment Variables, you can optionally add:
   - `SMTP_USER`: `hr.oligarchmedia@gmail.com`
   - `SMTP_PASS`: Your 16-character Google App Password

---

## 💻 Local Development Setup

To run the application locally on your machine:

```bash
# 1. Install dependencies
npm install

# 2. Start full-stack local server (Vite + Express on port 3000)
npm run dev

# 3. Build for production
npm run build

# 4. Preview production build locally
npm start
```

---

## 🔒 Cloud Database & Privacy
- **Database Configuration**: Stored in `firebase-applet-config.json`.
- **Security Rules**: Stored in `firestore.rules`.
- **Data Protection**: Sensitive credentials (e.g., Google App Passwords) are managed directly within the UI Settings Panel or server environment variables.
