import React, { useRef, useState } from 'react';
import { ArrowUpRight, Calculator, Atom, Expand, X, Pencil, MessageCircle, Lightbulb } from 'lucide-react';
import './ClassroomGallery.css';
const lessons = [
  {subject:'Maths', title:'From points on a graph to a clearer picture.', caption:'Working through graph questions, one step at a time.', src:'/lessons/maths-class.png', width:2308, height:934, icon:Calculator, alt:'An online Maths lesson showing a coordinate graph and multiple-choice answers, with the student visible in a video tile.'},
  {subject:'Science', title:'Draw it. Discuss it. Understand it.', caption:'Exploring science through sketches and conversation.', src:'/lessons/science-class.png', width:2236, height:1017, icon:Atom, alt:'An online Science lesson showing hand-drawn diagrams on a digital whiteboard, with the student visible in a video tile.'},
];
export default function ClassroomGallery({onTrial, hero=false}){
 const [active,setActive]=useState(0);
 const viewer=useRef(null), opener=useRef(null), oldOverflow=useRef('');
 const open=(index,event)=>{setActive(index);opener.current=event.currentTarget;oldOverflow.current=document.body.style.overflow;viewer.current.showModal();document.body.style.overflow='hidden'};
 const close=()=>viewer.current.close();
 const restore=()=>{document.body.style.overflow=oldOverflow.current;opener.current?.focus()};
 return <section className={hero ? "classroom-section classroom-hero" : "classroom-section section-wrap section-space"} id="real-classes">
  {hero && <div className="hero-class-label"><span/> INSIDE OUR REAL CLASSES <span className="hero-class-note">Your seat is waiting.</span></div>}
  {!hero && <div className="section-heading"><div><span className="eyebrow">A WINDOW INTO KULKARNI ACADEMY</span><h2>Real classes.<br/><span className="serif">Real moments of understanding.</span></h2></div><p>A peek into our one-to-one lessons.<br/>Your questions. Our shared whiteboard.<br/>A little more clarity, together.</p></div>}
  <div className="classroom-grid">{lessons.map((lesson,index)=>{const Icon=lesson.icon;return <article className={`classroom-card classroom-${lesson.subject.toLowerCase()}`} key={lesson.subject}><div className="classroom-card-bar"><span><Icon size={19}/>{lesson.subject} in action</span><span className="classroom-session-label">1 STUDENT · 1 TUTOR</span></div><button className="classroom-image-button" onClick={event=>open(index,event)} aria-label={`Enlarge ${lesson.subject} lesson screenshot`}><img src={lesson.src} alt={lesson.alt} width={lesson.width} height={lesson.height} loading={hero ? "eager" : "lazy"} fetchPriority={hero && index===0 ? "high" : "auto"} decoding="async"/><span className="classroom-expand"><Expand size={16}/> Take a closer look</span></button><div className="classroom-card-copy"><h3>{lesson.title}</h3><p>{lesson.caption}</p><button className="text-link purple-link" onClick={()=>onTrial(lesson.subject)}>Try a {lesson.subject} lesson free <ArrowUpRight size={18}/></button></div></article>})}</div>
  {!hero && <div className="classroom-method" aria-label="Our lesson approach"><span><MessageCircle size={21}/> Ask a question</span><span aria-hidden="true">→</span><span><Pencil size={21}/> Work it out together</span><span aria-hidden="true">→</span><span><Lightbulb size={21}/> Make it click</span></div>}
  <dialog ref={viewer} className="classroom-viewer" aria-labelledby="classroom-viewer-title" onClose={restore} onClick={event=>{if(event.target===viewer.current)close()}}><div className="classroom-viewer-header"><h2 id="classroom-viewer-title">Inside a real {lessons[active].subject} class</h2><button onClick={close} aria-label="Close lesson screenshot" autoFocus><X size={24}/></button></div><img src={lessons[active].src} alt={lessons[active].alt} width={lessons[active].width} height={lessons[active].height}/><p>{lessons[active].caption}</p><div className="classroom-viewer-nav">{lessons.map((lesson,index)=><button key={lesson.subject} aria-pressed={active===index} onClick={()=>setActive(index)}>{lesson.subject} lesson</button>)}</div></dialog>
 </section>;
}
