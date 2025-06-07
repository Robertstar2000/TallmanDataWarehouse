# Port Policy for Query Tool

**Always use the same port for each service. Do NOT increment or change ports if a port is in use.**

- Before starting the UI (Vite/dev server) or API (Node/Express), kill any process on the required port.
- For Windows/PowerShell, use:

```
powershell -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force"
```

- UI (Vite): Port 5173
- API (Node backend): Port 3001

**Update all start/build scripts to enforce this policy.**

If you see a port-in-use error, do NOT change the port. Instead, kill the process and retry.

---

This policy ensures reliable development and deployment, and avoids confusion from multiple instances running on different ports.
