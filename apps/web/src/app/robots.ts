import type {MetadataRoute} from 'next';
import {siteOrigin} from '@/config/site';
import {searchIndexable} from '@/lib/seo';
export const dynamic='force-dynamic';
export default function robots():MetadataRoute.Robots{
 // Let crawlers read private-route noindex directives; robots.txt is not access control.
 return searchIndexable()?{rules:{userAgent:'*',allow:'/'},sitemap:`${siteOrigin()}/sitemap.xml`}:{rules:{userAgent:'*',disallow:'/'}};
}
