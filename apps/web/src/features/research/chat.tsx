'use client';
import {useEffect,useRef,useState} from 'react';
import {ArrowUp,Check,Copy,Layers3,Plus,ScanSearch,ShieldCheck,Sparkles,User,Wallet} from 'lucide-react';
import {useMutation} from '@tanstack/react-query';
import {useLocale,useTranslations} from 'next-intl';
import {hasFeature,useResearch} from './session';
import {ChatReplySchema} from './contracts';
import {Locked,PageHeading,ResourceError} from './ui';
import {ApiError} from '@/lib/api';
import './chat.css';

const MAX_CHARS=2000; // Same limit as the API (AGENT_LIMITS.maxUserMessageChars).
type Turn={id:number;role:'user'|'assistant';text:string;tools?:string[];notes?:string[]};
const CHAT_ERRORS=['CHAT_UNAVAILABLE','CHAT_BUSY','CHAT_BUDGET_EXHAUSTED','CHAT_USER_BUDGET_EXHAUSTED','CHAT_DAILY_LIMIT','CONVERSATION_FULL','RATE_LIMITED'];
/**
 * Research assistant. It reads data and explains it; it cannot trade. Replies are plain text, never markup, and any
 * suggested setting change is only shown here: this screen has no way to apply one.
 */
export function ChatPage(){
 const {access}=useResearch();
 const t=useTranslations('workspace');
 if(!hasFeature(access,'research.chat'))return <><PageHeading title={t('agent')} body={t('agentBody')}/><Locked tier={access.features['research.chat']?.requiredTier}/></>;
 return <ChatSession/>;
}
function ChatSession(){
 const locale=useLocale();
 const t=useTranslations('workspace'),{send}=useResearch(),[turns,setTurns]=useState<Turn[]>([]),[draft,setDraft]=useState(''),[copied,setCopied]=useState<number|null>(null),[copyError,setCopyError]=useState(false),conversation=useRef<string|undefined>(undefined),next=useRef(1),input=useRef<HTMLTextAreaElement>(null),latest=useRef<HTMLDivElement>(null),follow=useRef(true);
 useEffect(()=>{
  const node=latest.current;
  if(!node||typeof IntersectionObserver==='undefined')return;
  const observer=new IntersectionObserver(([entry])=>{follow.current=entry?.isIntersecting??false;},{threshold:0});
  observer.observe(node);return()=>observer.disconnect();
 },[]);
 const ask=useMutation({
  mutationFn:(message:string)=>send('chat',ChatReplySchema,'POST',{...(conversation.current?{conversationId:conversation.current}:{}),message}),
   onSuccess:reply=>{conversation.current=reply.conversationId;setTurns(c=>[...c,{id:next.current++,role:'assistant',text:reply.reply.text,tools:reply.toolsUsed,notes:reply.proposals.map(p=>p.summary)}]);},
   onError:(_error,message)=>setDraft(current=>current||message),
  });
 useEffect(()=>{if(turns.length&&follow.current)latest.current?.scrollIntoView?.({block:'nearest'});},[turns.length,ask.isPending]);
 const submit=()=>{const message=draft.trim();if(!message||message.length>MAX_CHARS||ask.isPending)return;follow.current=true;setTurns(c=>ask.isError&&c.at(-1)?.role==='user'&&c.at(-1)?.text===message?c:[...c,{id:next.current++,role:'user',text:message}]);setDraft('');setCopyError(false);ask.mutate(message);input.current?.focus();};
 const error=ask.error,code=error instanceof ApiError?error.code:'';
 const starters=[{key:'narratives',Icon:Layers3},{key:'wallets',Icon:Wallet},{key:'risk',Icon:ScanSearch}] as const;
 const copy=async(turn:Turn)=>{try{await navigator.clipboard.writeText(turn.text);setCopied(turn.id);setCopyError(false);}catch{setCopyError(true);}};
 return <div className="agent-page"><PageHeading title={t('agent')} body={t('agentBody')} actions={<button type="button" className="research-control" disabled={ask.isPending||(!turns.length&&!draft)} onClick={()=>{conversation.current=undefined;setTurns([]);setDraft('');setCopied(null);setCopyError(false);ask.reset();input.current?.focus();}}><Plus size={15} aria-hidden="true"/>{t('chNew')}</button>}/>
  <div className="agent-safety"><ShieldCheck size={16} aria-hidden="true"/><span>{t('agentUi.researchOnly')}</span><span className="agent-safety-detail">{t('agentUi.noActions')}</span></div>
  {!turns.length&&<section className="agent-welcome" aria-labelledby="agent-welcome-title"><span className="agent-emblem"><Sparkles size={26} aria-hidden="true"/></span><p className="agent-eyebrow">{t('agentUi.eyebrow')}</p><h2 id="agent-welcome-title">{t('agentUi.welcome')}</h2><p className="agent-intro">{t('agentUi.welcomeBody')}</p>
   <div className="agent-starters">{starters.map(({key,Icon})=><button type="button" key={key} className="agent-starter" onClick={()=>{setDraft(t(`agentUi.prompts.${key}.question`));input.current?.focus();}}><Icon size={19} aria-hidden="true"/><strong>{t(`agentUi.prompts.${key}.title`)}</strong><span>{t(`agentUi.prompts.${key}.description`)}</span><span className="agent-starter-action">{t('agentUi.usePrompt')} <ArrowUp size={13} aria-hidden="true"/></span></button>)}</div>
  </section>}
  <div className="chat-log" role="log" aria-label={t('agentUi.conversation')} aria-live="polite" aria-relevant="additions text">
   {turns.map(turn=><article key={turn.id} className={`chat-turn chat-${turn.role}`} aria-label={turn.role==='user'?t('chYou'):t('chAssistant')}><div className="agent-turn-heading"><span className="agent-avatar">{turn.role==='user'?<User size={15} aria-hidden="true"/>:<Sparkles size={15} aria-hidden="true"/>}</span><b>{turn.role==='user'?t('chYou'):t('chAssistant')}</b>{turn.role==='assistant'&&<button type="button" className="agent-copy" onClick={()=>void copy(turn)} aria-label={t('agentUi.copy')}>{copied===turn.id?<Check size={14} aria-hidden="true"/>:<Copy size={14} aria-hidden="true"/>}{t(copied===turn.id?'agentUi.copied':'agentUi.copy')}</button>}</div><p className="chat-text">{turn.text}</p>
    {!!turn.tools?.length&&<details className="agent-sources"><summary>{t('agentUi.tools',{count:turn.tools.length})}</summary><small>{t('chTools',{tools:turn.tools.join(', ')})}</small></details>}
    {!!turn.notes?.length&&<div className="agent-suggestions"><b>{t('chSuggestions')}</b><ul>{turn.notes.map((n,i)=><li key={i}>{n}</li>)}</ul><small><ShieldCheck size={13} aria-hidden="true"/>{t('chNotApplied')}</small></div>}</article>)}
   {ask.isPending&&<div className="agent-thinking" role="status"><span className="agent-avatar"><Sparkles size={15} aria-hidden="true"/></span><span>{t('chThinking')}</span><span className="agent-thinking-dots" aria-hidden="true"><i/><i/><i/></span></div>}
  </div><div ref={latest} className="agent-latest"/>
  <div role="status" className="sr-only">{copyError?t('agentUi.copyError'):copied!==null?t('agentUi.copied'):''}</div>
  <div className="agent-composer-wrap">{ask.isError&&<div className="agent-error">{code==='FEATURE_LOCKED'||!CHAT_ERRORS.includes(code)?<ResourceError error={error} retry={submit}/>:<p role="alert">{t(`chErrors.${code}`)}</p>}<p>{t('agentUi.draftRestored')}</p></div>}
   <form className="chat-form" onSubmit={e=>{e.preventDefault();submit();}}>
    <label htmlFor="chat-input">{t('chInput')}</label>
    <textarea ref={input} id="chat-input" rows={2} maxLength={MAX_CHARS} placeholder={t('agentUi.placeholder')} aria-describedby="agent-composer-help" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)&&!e.nativeEvent.isComposing){e.preventDefault();submit();}}}/>
    <div className="chat-actions"><small id="agent-composer-help">{t('agentUi.shortcut')}</small><div><small className={draft.length>=MAX_CHARS?'agent-limit':''}>{draft.length.toLocaleString(locale)} / {MAX_CHARS.toLocaleString(locale)}</small><button type="submit" className="research-control admin-primary" disabled={!draft.trim()||ask.isPending}><ArrowUp size={15} aria-hidden="true"/>{t(ask.isPending?'agentUi.sending':'chSend')}</button></div></div>
   </form><p className="agent-disclaimer">{t('chNotice')}</p>
  </div>
 </div>;
}
