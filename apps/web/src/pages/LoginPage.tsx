import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { AuthShell, EMAIL_RE, ErrorBanner, PasswordField, SubmitButton } from "./AuthForm";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

interface LocationState {
  from?: string;
}

export default function LoginPage() {
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  // Honor the return path (e.g. /invite/:token) when already signed in too.
  const fromPath = (location.state as LocationState | null)?.from;
  if (user) return <Navigate to={fromPath && fromPath !== "/login" ? fromPath : "/dashboard"} replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof fieldErrors = {};
    if (!EMAIL_RE.test(email.trim())) errs.email = "Enter a valid email address.";
    if (password.length < 8) errs.password = "Password must be at least 8 characters.";
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const ok = await login({ email, password });
    if (ok) {
      const from = (location.state as LocationState | null)?.from;
      navigate(from && from !== "/login" ? from : "/dashboard", { replace: true });
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to your CollabCode account."
      footer={<>New to CollabCode? <Link to="/register" className="font-medium text-sky-600 hover:underline dark:text-sky-400">Create an account</Link></>}
    >
      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
        <ErrorBanner message={error} />
        <div className="space-y-1.5">
          <Label htmlFor="login-email">Email</Label>
          <Input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-invalid={fieldErrors.email ? "true" : undefined} />
          {fieldErrors.email && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{fieldErrors.email}</p>}
        </div>
        <PasswordField id="login-password" label="Password" value={password} onChange={setPassword} error={fieldErrors.password} autoComplete="current-password" />
        <SubmitButton loading={isLoading}>Log in</SubmitButton>
      </form>
    </AuthShell>
  );
}
