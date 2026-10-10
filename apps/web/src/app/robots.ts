import type {MetadataRoute} from 'next';
import {siteOrigin} from '@/config/site';
export default function robots():MetadataRoute.Robots{return {rules:{userAgent:'*',allow:'/',disallow:['/app','/early-access','/id/app','/id/early-access']},sitemap:`${siteOrigin()}/sitemap.xml`};}
