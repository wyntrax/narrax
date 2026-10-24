/** Saves text the API produced as a file in the browser. Kept separate so a test can replace it. */
export function saveTextFile(name:string,text:string,type:string){
 const blob=new Blob([text],{type});
 const url=URL.createObjectURL(blob);
 try{
  const link=document.createElement('a');
  link.href=url;link.download=name;link.rel='noopener';
  document.body.appendChild(link);link.click();link.remove();
 }finally{URL.revokeObjectURL(url);}
}
