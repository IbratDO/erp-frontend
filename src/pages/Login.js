import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { canAccessRoute, getDefaultHomePath } from '../utils/permissions';
import BusyForm, { SubmitButton } from '../components/BusyForm';
import './Login.css';

const Login = () => {
  const { t } = useTranslation('common');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await login(username, password);

    if (result.success) {
      const user = result.user;
      const from = location.state?.from?.pathname;
      const target =
        from && canAccessRoute(user, from) ? from : getDefaultHomePath(user);
      navigate(target, { replace: true });
    } else {
      setError(result.error || t('auth.invalidCredentials'));
    }

    setLoading(false);
  };

  return (
    <div className="login-container">
      <div className="login-box">
        <h1>{t('app.title')}</h1>
        <h2>{t('app.subtitle')}</h2>
        <BusyForm onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">{t('auth.username')}</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">{t('auth.password')}</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <div className="error-message">{error}</div>}
          <SubmitButton
            disabled={loading}
            className="login-button"
            busyLabel={t('auth.loggingIn')}
          >
            {loading ? t('auth.loggingIn') : t('auth.login')}
          </SubmitButton>
        </BusyForm>
      </div>
    </div>
  );
};

export default Login;
