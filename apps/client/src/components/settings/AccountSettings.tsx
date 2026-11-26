import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LIMITS } from '@nexusvoice/shared';
import { api } from '../../lib/api';
import { getServerUrl } from '../../lib/config';
import { signOut } from '../../services/socket';
import { useAppStore } from '../../store/useAppStore';
import { Avatar, ProfileBanner } from '../Avatar';
import { formatBytes } from '../chat/MessageMedia';
import { Section, buttonClass, inputClass, secondaryButtonClass } from './SettingsControls';

export function AccountSettings() {
  const me = useAppStore((s) => s.me);
  const setMe = useAppStore((s) => s.setMe);
  const [displayName, setDisplayName] = useState(me?.displayName ?? '');
  const [bio, setBio] = useState(me?.bio ?? '');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const avatarInput = useRef<HTMLInputElement | null>(null);
  const bannerInput = useRef<HTMLInputElement | null>(null);

  // Se o perfil mudar por outra janela ou aparelho, os campos acompanham.
  useEffect(() => {
    setDisplayName(me?.displayName ?? '');
    setBio(me?.bio ?? '');
  }, [me?.displayName, me?.bio]);

  if (!me) return null;

  async function uploadImage(kind: 'avatar' | 'banner', file: File | undefined): Promise<void> {
    if (!file) return;
    const max = kind === 'avatar' ? LIMITS.avatarMaxBytes : LIMITS.bannerMaxBytes;
    if (file.size > max) {
      setStatus({ ok: false, text: `A imagem passa do limite de ${formatBytes(max)}.` });
      return;
    }
    setBusy(kind);
    const result = await api.uploadProfileImage(kind, file);
    setBusy(null);
    if (result.ok && result.data) {
      setMe(result.data);
      setStatus({ ok: true, text: kind === 'avatar' ? 'Avatar atualizado!' : 'Banner atualizado!' });
    } else {
      setStatus({ ok: false, text: result.error ?? 'Não foi possível enviar a imagem.' });
    }
  }

  async function removeImage(kind: 'avatar' | 'banner'): Promise<void> {
    setBusy(kind);
    const result = await api.removeProfileImage(kind);
    setBusy(null);
    if (result.ok && result.data) setMe(result.data);
  }

  async function saveProfile(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy('profile');
    const result = await api.updateProfile({ displayName, bio });
    setBusy(null);
    if (result.ok && result.data) {
      setMe(result.data);
      setStatus({ ok: true, text: 'Perfil salvo!' });
    } else {
      setStatus({ ok: false, text: result.error ?? 'Não foi possível salvar.' });
    }
  }

  async function savePassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy('password');
    const result = await api.changePassword(currentPassword, newPassword);
    setBusy(null);
    if (result.ok) {
      setCurrentPassword('');
      setNewPassword('');
      setStatus({ ok: true, text: 'Senha trocada!' });
    } else {
      setStatus({ ok: false, text: result.error ?? 'Não foi possível trocar a senha.' });
    }
  }

  return (
    <div>
      {status && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-xs ${
            status.ok
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-red-500/30 bg-red-500/10 text-red-300'
          }`}
        >
          {status.text}
        </div>
      )}

      <Section
        title="Perfil"
        hint="Avatar e banner aceitam PNG, JPG, GIF e WEBP, inclusive animados. Na lista e no chat eles animam ao passar o mouse."
      >
        <div className="overflow-hidden rounded-xl border border-zinc-700 bg-[#232428]">
          <ProfileBanner url={me.bannerUrl} name={me.displayName} height={110} />
          <div className="flex items-end gap-3 px-4 pb-4">
            <div className="-mt-9 rounded-full border-[5px] border-[#232428]">
              <Avatar url={me.avatarUrl} name={me.displayName} size={80} animate />
            </div>
            <div className="min-w-0 pb-1">
              <div className="truncate text-lg font-bold text-white">{me.displayName}</div>
              <div className="text-xs text-zinc-400">@{me.username}</div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy === 'avatar'}
            onClick={() => avatarInput.current?.click()}
            className={buttonClass}
          >
            {busy === 'avatar' ? 'Enviando...' : 'Trocar avatar'}
          </button>
          {me.avatarUrl && (
            <button type="button" onClick={() => void removeImage('avatar')} className={secondaryButtonClass}>
              Tirar avatar
            </button>
          )}
          <button
            type="button"
            disabled={busy === 'banner'}
            onClick={() => bannerInput.current?.click()}
            className={buttonClass}
          >
            {busy === 'banner' ? 'Enviando...' : 'Trocar banner'}
          </button>
          {me.bannerUrl && (
            <button type="button" onClick={() => void removeImage('banner')} className={secondaryButtonClass}>
              Tirar banner
            </button>
          )}
          <input
            ref={avatarInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(e) => {
              void uploadImage('avatar', e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <input
            ref={bannerInput}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(e) => {
              void uploadImage('banner', e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        <form onSubmit={(e) => void saveProfile(e)} className="space-y-2">
          <label className="block text-xs text-zinc-400">
            Nome de exibição
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={LIMITS.displayNameMax}
              className={`${inputClass} mt-1`}
            />
          </label>
          <label className="block text-xs text-zinc-400">
            Sobre mim ({bio.length}/{LIMITS.bioMax})
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={LIMITS.bioMax}
              rows={3}
              className={`${inputClass} mt-1 resize-none`}
            />
          </label>
          <button type="submit" disabled={busy === 'profile'} className={buttonClass}>
            Salvar perfil
          </button>
        </form>
      </Section>

      <Section title="Senha">
        <form onSubmit={(e) => void savePassword(e)} className="space-y-2">
          <input
            type="password"
            placeholder="Senha atual"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            className={inputClass}
          />
          <input
            type="password"
            placeholder={`Nova senha (mínimo ${LIMITS.passwordMin} caracteres)`}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={LIMITS.passwordMin}
            autoComplete="new-password"
            className={inputClass}
          />
          <button
            type="submit"
            disabled={busy === 'password' || !currentPassword || newPassword.length < LIMITS.passwordMin}
            className={buttonClass}
          >
            Trocar senha
          </button>
        </form>
      </Section>

      <Section title="Sessão">
        <p className="text-xs text-zinc-400">
          Conectado em <span className="font-mono text-zinc-200">{getServerUrl()}</span>
        </p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="cursor-pointer rounded-lg border border-red-500/40 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10"
        >
          Sair da conta
        </button>
      </Section>
    </div>
  );
}
