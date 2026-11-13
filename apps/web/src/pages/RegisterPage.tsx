import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";
import { AuthShell, EMAIL_RE, ErrorBanner, PasswordField, SubmitButton } from "./AuthForm";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

interface LocationState {
  from?: string;
}

export default function RegisterPage() {
  const user = useAuthStore((s) => s.user);
  const register = useAuthStore((s) => s.register);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const navigate = useNavigate();
  const location = useLocation();
  // Honor the return path (e.g. /invite/:token) so invite links survive sign-up.
  const fromPath = (location.state as LocationState | null)?.from;
  const destination = fromPath && fromPath !== "/register" ? fromPath : "/dashboard";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; password?: string; confirm?: string }>({});

  if (user) return <Navigate to={destination} replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const errs: typeof fieldErrors = {};
    if (!name.trim()) errs.name = "Name is required.";
    if (!EMAIL_RE.test(email.trim())) errs.email = "Enter a valid email address.";
    if (password.length < 8) errs.password = "Password must be at least 8 characters.";
    if (confirm !== password) errs.confirm = "Passwords do not match.";
    setFieldErrors(errs);
    if (Object.keys(errs).length > 0) return;
    const ok = await register({ name, email, password });
    if (ok) navigate(destination, { replace: true });
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start collaborating in minutes. Your account is created on the CollabCode server."
      footer={<>Already have an account? <Link to="/login" className="font-medium text-sky-600 hover:underline dark:text-sky-400">Log in</Link></>}
    >
      <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
        <ErrorBanner message={error} />
        <div className="space-y-1.5">
          <Label htmlFor="register-name">Name</Label>
          <Input id="register-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-invalid={fieldErrors.name ? "true" : undefined} />
          {fieldErrors.name && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{fieldErrors.name}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="register-email">Email</Label>
          <Input id="register-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-invalid={fieldErrors.email ? "true" : undefined} />
          {fieldErrors.email && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{fieldErrors.email}</p>}
        </div>
        <PasswordField id="register-password" label="Password" value={password} onChange={setPassword} error={fieldErrors.password} autoComplete="new-password" />
        <PasswordField id="register-confirm" label="Confirm password" value={confirm} onChange={setConfirm} error={fieldErrors.confirm} autoComplete="new-password" />
        <SubmitButton loading={isLoading}>Create account</SubmitButton>
      </form>
    </AuthShell>
  );
}
