export function siteOrigin(){const value=process.env.NEXT_PUBLIC_SITE_URL||'http://localhost:4010';const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.origin!==value)throw new Error('NEXT_PUBLIC_SITE_URL must be a bare public web origin');return url.origin;}
/** Static renderer tokens: the same approved values as globals.css. */
export const OG_TOKENS={background:'#08090B',surface:'#0D0F12',text:'#F5F7FA',secondary:'#A4A9B3',accent:'#B8FF4F',ink:'#0B1200'} as const;
