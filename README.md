# KuriPuro by JBM

Cleaning company management system — check-in/out, employees, salary, clients, cashflow, 領収書.

## Stack
React 18 + Vite · Supabase · Vercel · jsPDF · react-hot-toast

## Setup

### 1. Supabase
1. Create a new project at supabase.com
2. Open the SQL Editor and run `schema.sql`
3. Copy your project URL and anon key

### 2. Environment
```bash
cp .env.example .env
# Fill in your Supabase URL and anon key
```

### 3. Install & run
```bash
npm install
npm run dev
```

### 4. Deploy
```bash
npm run build
git init
git add .
git commit -m "init kuripuro"
git remote add origin https://github.com/YOUR_USER/kuripuro.git
git push -u origin main
# Then connect repo in Vercel and add env vars
```

Or with the standard pipeline (add env vars in Vercel dashboard):
```bash
npm run build && git add . && git commit -m "deploy" && git push
npx vercel --prod --yes
```

## Features
- **Dashboard** — revenue, profit, today's check-ins, complaints, profitability chart
- **Check-in/out** — employee + client, time, transport route & cost, before/during/after photos, 領収書 shortcut
- **Employees** — registration (personal data + bank account), score system (100 pts − complaints), complaint tracking
- **Salary** — payroll calculation by period, transport allowance, bonus/deductions, CSV export, payslip
- **Clients** — contract value, profitability per client, margin analysis
- **Cashflow** — income/expense entries, net balance, accumulated balance
- **領収書** — receipt generator with live preview + jsPDF download, history

## Language
Switch between English and Japanese (日本語) via sidebar toggle.
