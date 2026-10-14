'use client';
import {useMemo,useRef,useState} from 'react';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useLocale,useTranslations} from 'next-intl';
import {useAuth} from '@/components/auth/context';
import {ApiError} from '@/lib/api';
import {useResearch} from '@/features/research/session';
import {Loading,PageHeading,ResourceError} from '@/features/research/ui';
import {createAdminApi,type AdminApi} from './api';
import {effectiveStatus,shortAddress,toPayload,toSettings,type AdminGrant,type AdminSettings} from './contracts';
import {RuntimeCard} from './runtime-card';

const ERROR_KEYS = {
  FORBIDDEN: 'adminErrForbidden', EARLY_ACCESS_DISABLED: 'adminErrDisabled', EARLY_ACCESS_FULL: 'adminErrFull', VERIFIED_WALLET_REQUIRED: 'adminErrWallet',
  INVALID_INPUT: 'adminErrInvalid', WALLET_LINK_UNAVAILABLE: 'adminErrDomain', UNAUTHORIZED: 'adminErrSession', RATE_LIMITED: 'adminErrRate',
} as const;
const DAYS = [7, 30, 90, 365];

function useAdmin() {
  const auth = useAuth(), {userId} = useResearch(), token = useRef(auth.getAccessToken);
  token.current = auth.getAccessToken;
  const api = useMemo(() => createAdminApi(() => token.current()), []);
  return {api, userId, key: (name: string) => ['admin', userId, name] as const};
}
function useErrorText() {
  const t = useTranslations('workspace');
  return (error: unknown) => {
    const code = error instanceof ApiError ? (error.status === 403 ? 'FORBIDDEN' : error.code) : 'UNKNOWN';
    return code in ERROR_KEYS ? t(ERROR_KEYS[code as keyof typeof ERROR_KEYS]) : `${t('adminErrUnknown')} (${code})`;
  };
}
function useWhen() {
  const locale = useLocale();
  return (iso: string | null) => iso ? new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(iso)) : null;
}

export function AdminPage() {
  const t = useTranslations('workspace'), {api, key} = useAdmin();
  const settings = useQuery({queryKey: key('settings'), queryFn: () => api.settings(), retry: false, gcTime: 0});
  const heading = <PageHeading title={t('adminTitle')} body={t('adminBody')}/>;
  if (settings.isPending) return <>{heading}<Loading/></>;
  if (settings.isError) {
    if (settings.error instanceof ApiError && settings.error.status === 403) {
      return <>{heading}<div className="research-state" role="alert"><h2>{t('adminForbidden')}</h2><p>{t('adminForbiddenHelp')}</p><code className="admin-code">npm run make-admin -- --list</code></div></>;
    }
    return <>{heading}<ResourceError error={settings.error} retry={() => void settings.refetch()}/></>;
  }
  return <>{heading}
    <div className="admin-grid">
      <SettingsCard api={api} initial={toSettings(settings.data.items)}/>
      <WhitelistCard api={api}/>
    </div>
    <GrantsCard api={api}/>
    <RuntimeCard api={api} queryKey={key('runtime')}/>
  </>;
}

function SettingsCard({api, initial}: {api: AdminApi; initial: AdminSettings}) {
  const t = useTranslations('workspace'), text = useErrorText(), client = useQueryClient(), {key} = useAdmin();
  const [form, setForm] = useState({...initial, cap: String(initial.cap)}), [reason, setReason] = useState('');
  const stats = useQuery({queryKey: key('stats'), queryFn: () => api.stats(), retry: false, gcTime: 0});
  const save = useMutation({
    mutationFn: () => api.save(toPayload({...form, cap: Number(form.cap)}), reason.trim()),
    onSuccess: async () => {await client.invalidateQueries({queryKey: key('stats')});},
  });
  const valid = /^\d{1,9}$/.test(form.cap) && reason.trim().length > 0;
  const set = <K extends keyof typeof form>(name: K, value: (typeof form)[K]) => {save.reset(); setForm(current => ({...current, [name]: value}));};
  return <section className="admin-card" aria-labelledby="admin-settings">
    <h2 id="admin-settings">{t('adminSettings')}</h2>
    {stats.data && <p className="admin-stat" role="status">{t('adminSeats', {occupied: stats.data.occupied, cap: stats.data.cap, available: stats.data.available})}</p>}
    <form onSubmit={event => {event.preventDefault(); if (valid) save.mutate();}} className="admin-form">
      <label className="admin-check"><input type="checkbox" checked={form.enabled} onChange={event => set('enabled', event.target.checked)}/><span><b>{t('adminOpen')}</b><small>{t('adminOpenHelp')}</small></span></label>
      <div className="admin-field"><label htmlFor="admin-cap">{t('adminCap')}</label><input id="admin-cap" inputMode="numeric" value={form.cap} onChange={event => set('cap', event.target.value.trim())} aria-invalid={!/^\d{1,9}$/.test(form.cap)}/></div>
      <div className="admin-field"><label htmlFor="admin-domain">{t('adminDomain')}</label><div className="admin-inline"><input id="admin-domain" value={form.domain} placeholder="http://localhost:4010" onChange={event => set('domain', event.target.value.trim())}/><button type="button" className="research-control" onClick={() => set('domain', window.location.origin)}>{t('adminUseOrigin')}</button></div><small>{t('adminDomainHelp')}</small></div>
      <label className="admin-check"><input type="checkbox" checked={form.enforced} onChange={event => set('enforced', event.target.checked)}/><span><b>{t('adminEnforce')}</b><small>{t('adminEnforceHelp')}</small></span></label>
      <label className="admin-check"><input type="checkbox" checked={form.shadow} onChange={event => set('shadow', event.target.checked)}/><span><b>{t('adminShadow')}</b></span></label>
      <div className="admin-field"><label htmlFor="admin-reason">{t('adminReason')}</label><input id="admin-reason" maxLength={300} value={reason} onChange={event => {save.reset(); setReason(event.target.value);}}/></div>
      <div className="admin-actions">
        <button type="submit" className="research-control admin-primary" disabled={!valid || save.isPending}>{t('adminSave')}</button>
        <button type="button" className="research-control" onClick={() => {save.reset(); setForm(current => ({...current, enabled: true, cap: String(Math.max(Number(current.cap) || 0, 25)), domain: window.location.origin})); setReason(current => current || 'Local testing');}}>{t('adminPreset')}</button>
      </div>
      {save.isSuccess && <p role="status" className="admin-ok">{t('adminSaved')}</p>}
      {save.isError && <p role="alert" className="admin-bad">{text(save.error)}</p>}
    </form>
  </section>;
}

function WhitelistCard({api}: {api: AdminApi}) {
  const t = useTranslations('workspace'), [q, setQ] = useState('');
  const lookup = useMutation({mutationFn: (value: string) => api.lookup(value)}), text = useErrorText();
  return <section className="admin-card" aria-labelledby="admin-whitelist">
    <h2 id="admin-whitelist">{t('adminWhitelist')}</h2>
    <p>{t('adminWhitelistHelp')}</p>
    <form onSubmit={event => {event.preventDefault(); if (q) lookup.mutate(q);}} className="admin-inline">
      <label className="sr-only" htmlFor="admin-find">{t('adminSearch')}</label>
      <input id="admin-find" value={q} placeholder={t('adminSearch')} maxLength={100} onChange={event => setQ(event.target.value.trim())}/>
      <button type="submit" className="research-control" disabled={!q || lookup.isPending}>{t('adminFind')}</button>
    </form>
    {lookup.isError && <p role="alert" className="admin-bad">{text(lookup.error)}</p>}
    {lookup.data && !lookup.data.items.length && <p role="status">{t('adminNoUser')}</p>}
    {lookup.data?.items.map(user => <UserResult key={user.id} api={api} user={user}/>)}
  </section>;
}

function UserResult({api, user}: {api: AdminApi; user: {id: string; wallets: {id: string; address: string}[]}}) {
  const t = useTranslations('workspace'), text = useErrorText(), client = useQueryClient(), {key} = useAdmin();
  const [days, setDays] = useState(30), [reason, setReason] = useState('Whitelisted by admin');
  const grant = useMutation({
    mutationFn: () => api.grant(user.id, new Date(Date.now() + days * 86400000).toISOString(), reason.trim()),
    onSuccess: async () => {await client.invalidateQueries({queryKey: key('grants')}); await client.invalidateQueries({queryKey: key('stats')});},
  });
  return <div className="admin-user">
    <p className="admin-mono" title={user.id}>{user.id}</p>
    <p><b>{t('adminUserWallets')}</b></p>
    {user.wallets.length ? <ul className="admin-wallets">{user.wallets.map(wallet => <li key={wallet.id} className="admin-mono" title={wallet.address}>{wallet.address}</li>)}</ul> : <p className="admin-bad" role="status">{t('adminNoWallets')}</p>}
    <div className="admin-inline">
      <label className="sr-only" htmlFor={`days-${user.id}`}>{t('adminDuration')}</label>
      <select id={`days-${user.id}`} value={days} onChange={event => {grant.reset(); setDays(Number(event.target.value));}}>{DAYS.map(value => <option key={value} value={value}>{t('adminDays', {days: value})}</option>)}</select>
      <button type="button" className="research-control admin-primary" disabled={!user.wallets.length || !reason.trim() || grant.isPending} onClick={() => grant.mutate()}>{t('adminGrant')}</button>
    </div>
    <div className="admin-field"><label htmlFor={`reason-${user.id}`}>{t('adminReason')}</label><input id={`reason-${user.id}`} maxLength={300} value={reason} onChange={event => {grant.reset(); setReason(event.target.value);}}/></div>
    {grant.isSuccess && <p role="status" className="admin-ok">{t('adminGranted')}</p>}
    {grant.isError && <p role="alert" className="admin-bad">{text(grant.error)}</p>}
  </div>;
}

function GrantsCard({api}: {api: AdminApi}) {
  const t = useTranslations('workspace'), when = useWhen(), text = useErrorText(), client = useQueryClient(), {key} = useAdmin();
  const grants = useQuery({queryKey: key('grants'), queryFn: () => api.grants(), retry: false, gcTime: 0});
  const revoke = useMutation({
    mutationFn: (grant: AdminGrant) => api.revoke(grant.userId, grant.id, 'Revoked from the admin page'),
    onSuccess: async () => {await client.invalidateQueries({queryKey: key('grants')}); await client.invalidateQueries({queryKey: key('stats')});},
  });
  return <section className="admin-card admin-wide" aria-labelledby="admin-grants">
    <h2 id="admin-grants">{t('adminGrants')}</h2>
    {grants.isPending && <Loading/>}
    {grants.isError && <ResourceError error={grants.error} retry={() => void grants.refetch()}/>}
    {grants.data && !grants.data.items.length && <p role="status">{t('adminNoGrants')}</p>}
    {grants.data && grants.data.items.length > 0 && <div className="admin-scroll"><table className="admin-table">
      <thead><tr><th scope="col">{t('adminColWallet')}</th><th scope="col">{t('adminColSource')}</th><th scope="col">{t('adminColStatus')}</th><th scope="col">{t('adminColUntil')}</th><th scope="col"><span className="sr-only">{t('adminRevoke')}</span></th></tr></thead>
      <tbody>{grants.data.items.map(grant => {const status = effectiveStatus(grant); return <tr key={grant.id}>
        <td className="admin-mono" title={grant.wallets.join(', ') || grant.userId}>{grant.wallets.length ? grant.wallets.map(shortAddress).join(', ') : shortAddress(grant.userId)}</td>
        <td>{grant.source === 'ADMIN' ? t('adminSourceAdmin') : t('adminSourceSelf')}</td>
        <td><span className={`admin-badge admin-${status.toLowerCase()}`}>{status}</span></td>
        <td>{when(grant.validUntil) ?? t('adminNever')}</td>
        <td>{status === 'ACTIVE' && <button type="button" className="research-control" disabled={revoke.isPending} onClick={() => revoke.mutate(grant)}>{t('adminRevoke')}</button>}</td>
      </tr>;})}</tbody>
    </table></div>}
    {revoke.isError && <p role="alert" className="admin-bad">{text(revoke.error)}</p>}
  </section>;
}
