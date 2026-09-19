import React, { useState } from 'react';
import { ArrowUpRight, Atom, Calculator, Check, Lightbulb, RotateCcw } from 'lucide-react';

const subjects = [
  { name: 'Maths', icon: Calculator, intro: 'From “why this formula?” to “I can solve this.”', description: 'Build strong foundations, spot patterns, and work through problems one clear step at a time.', topics: ['Numbers & fractions', 'Algebra', 'Geometry', 'Data & probability'], symbol: 'x² + y²', note: 'A little logic. A lot of possibility.' },
  { name: 'Science', icon: Atom, intro: 'Big questions. Brilliant discoveries.', description: 'Connect what you learn to the world around you, from the forces that move us to the cells that make us.', topics: ['Physics', 'Chemistry', 'Biology', 'Scientific thinking'], symbol: 'H₂O', note: 'Stay curious. Ask another “why?”' },
];
const challenges = {
  Maths: { question: 'A notebook costs $20. It’s 25% off. What do you pay?', options: ['$5', '$15', '$25'], answer: '$15', explanation: '25% of $20 is $5. Subtract the discount: $20 − $5 = $15. Percentages make more sense when you put them to work!' },
  Science: { question: 'A plant grows towards a window. What is it responding to?', options: ['Sound', 'Light', 'Gravity'], answer: 'Light', explanation: 'This is phototropism: growth in response to light. Growing towards light helps a plant capture energy for photosynthesis.' },
};

export default function Subjects({ onTrial }) {
  const [subject, setSubject] = useState('Maths');
  const [answer, setAnswer] = useState(null);
  const challenge = challenges[subject];
  return <section className="subjects-section section-wrap section-space" id="subjects">
    <div className="section-heading"><div><span className="eyebrow">TWO SUBJECTS. ENDLESS DISCOVERIES.</span><h2>Make sense of numbers.<br/><span className="serif">Make sense of the world.</span></h2></div><p>Personal Maths & Science tuition for<br/>all national and international boards.<br/>Your syllabus. Your pace. Your potential.</p></div>
    <div className="subject-grid">{subjects.map(({name, icon: Icon, intro, description, topics, symbol, note}) => <article className={`subject-card ${name.toLowerCase()}`} key={name}>
      <div className="subject-card-top"><span className="subject-icon"><Icon size={25}/></span><span className="eyebrow">ONE-TO-ONE ONLINE</span></div>
      <div className="subject-art" aria-hidden="true"><span>{symbol}</span>{name==='Maths'?<svg viewBox="0 0 160 100"><path d="M15 85H145M25 95V10"/><path className="subject-curve" d="M30 73Q65 95 130 15"/><circle cx="95" cy="53" r="4"/></svg>:<Atom size={92} strokeWidth={1}/>}<small>{note}</small></div>
      <h3>{name}</h3><h4>{intro}</h4><p>{description}</p><div className="topic-list">{topics.map(topic=><span key={topic}>{topic}</span>)}</div>
      <button className="subject-cta" onClick={()=>onTrial(name)}>Try a free {name} class <ArrowUpRight size={19}/></button>
    </article>)}</div>
    <div className="board-banner"><span className="board-symbol"><Check size={20}/></span><div><strong>All national & international boards</strong><p>Share your board, year group, and current topics. We’ll shape the lessons around your school syllabus.</p></div><button className="text-link" onClick={()=>onTrial('I’d like help with my school syllabus.')}>Tell us your board <ArrowUpRight size={17}/></button></div>
    <div className="challenge-panel"><div className="challenge-intro"><span className="eyebrow"><Lightbulb size={15}/> YOUR FIRST LITTLE AHA!</span><h3>Curiosity looks<br/>good on you.</h3><p>Try a quick question. No marks, no pressure.<br/>Just a small taste of thinking things through.</p><div className="challenge-switch" role="group" aria-label="Choose a challenge subject">{subjects.map(({name,icon: Icon})=><button key={name} aria-pressed={subject===name} onClick={()=>{setSubject(name);setAnswer(null)}}><Icon size={15}/>{name}</button>)}</div></div>
      <div className="challenge-question"><span className="eyebrow">A QUICK {subject.toUpperCase()} CHALLENGE</span><h4>{challenge.question}</h4><div className="challenge-options" role="group" aria-label="Answer options">{challenge.options.map(option=><button key={option} aria-pressed={answer===option} className={answer===option?(option===challenge.answer?'correct':'try-again'):''} onClick={()=>setAnswer(option)}>{option}{answer===option&&option===challenge.answer&&<Check size={17}/>}</button>)}</div><div className="challenge-feedback" aria-live="polite" aria-atomic="true">{answer ? <><strong>{answer===challenge.answer?'That’s it! Here’s why.':'A good moment to think it through.'}</strong><p>{answer===challenge.answer?challenge.explanation:'Have another go. '+(subject==='Maths'?'Find a quarter of $20 first, then subtract it from the original price.':'What comes through the window that a plant uses to make its food?')}</p></>:<p>Pick an answer to discover the idea behind it.</p>}</div><div className="challenge-bottom"><button className="text-link purple-link" onClick={()=>onTrial(subject)}>Explore more in a free class <ArrowUpRight size={16}/></button>{answer&&<button className="reset-challenge" aria-label="Reset challenge" onClick={()=>setAnswer(null)}><RotateCcw size={15}/></button>}</div></div>
    </div>
  </section>;
}
