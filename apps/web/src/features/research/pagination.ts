'use client';
import {useState} from 'react';
export function usePagination(){const [cursors,setCursors]=useState<(string|undefined)[]>([undefined]);return {cursor:cursors[cursors.length-1],page:cursors.length,previous:()=>setCursors(old=>old.length>1?old.slice(0,-1):old),next:(cursor:string|null)=>{if(cursor)setCursors(old=>[...old,cursor]);}};}
