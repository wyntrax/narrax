import type {MetadataRoute} from 'next';
import {siteOrigin} from '@/config/site';
export default function sitemap():MetadataRoute.Sitemap {const origin=siteOrigin();return [{url:origin,alternates:{languages:{en:origin,id:`${origin}/id`}}},{url:`${origin}/id`,alternates:{languages:{en:origin,id:`${origin}/id`}}}];}
