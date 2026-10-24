export function siteOrigin(){const value=process.env.NEXT_PUBLIC_SITE_URL||'http://localhost:4010';const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.origin!==value)throw new Error('NEXT_PUBLIC_SITE_URL must be a bare public web origin');return url.origin;}
/** Static renderer tokens: the same approved values as globals.css. */
export const OG_TOKENS={background:'#000',surface:'#0D0D0D',text:'#fff',secondary:'#B0B0B0',accent:'#fff',ink:'#000'} as const;
