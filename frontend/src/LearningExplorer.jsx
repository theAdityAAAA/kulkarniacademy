import React, { useRef, useState } from 'react';
import { ArrowRight, ArrowLeft, Atom, Calculator, Compass, Lightbulb, MessageCircle, Pencil, RotateCcw, Sparkles, Target, Check, BookOpen, Eye, FlaskConical } from 'lucide-react';

const questions = [
  { title: 'What makes you curious?', note: 'Choose what you would most like to explore today.', icon: Compass, options: ['Solving number puzzles', 'Finding out how things work', 'A bit of both'], icons: [Calculator, Atom, Sparkles] },
  { title: 'When a question feels tricky, what do you usually do?', note: 'There is no right or wrong answer here.', icon: Lightbulb, options: ['Try a different approach', 'Ask someone for a hint', 'Pause and come back to it'], icons: [Pencil, MessageCircle, RotateCcw] },
  { title: 'What would you like to try in a lesson?', note: 'A preference for today, not a fixed learning type.', icon: BookOpen, options: ['See a diagram or demonstration', 'Talk through a worked example', 'Try a problem with a little guidance'], icons: [Eye, MessageCircle, FlaskConical] },
  { title: 'What would you like help with most?', note: 'Your goal helps us choose a starting point.', icon: Target, options: ['Understanding the basics', 'Feeling confident with questions', 'Preparing for a school test'], icons: [BookOpen, Sparkles, Pencil] },
  { title: 'What number comes next?', note: 'Look at how the pattern changes at each step.', icon: Calculator, options: ['12', '16', '18'], correct: 1, explanation: 'Each number doubles: 2 → 4 → 8 → 16. Multiplying by 2 gives the next number.', diagram: 'pattern' },
  { title: 'Which change turns ice into liquid water?', note: 'Think about what happens when ice gets warmer.', icon: Atom, options: ['Melting', 'Freezing', 'Condensing'], correct: 0, explanation: 'Melting changes a solid into a liquid. When ice gains enough heat, it becomes liquid water.', diagram: 'states' },
];

export default function LearningExplorer({ onTrial }) {
  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState(Array(questions.length).fill(null));
  const [complete, setComplete] = useState(false);
  const heading = useRef(null);
  const focusHeading = () => requestAnimationFrame(() => heading.current?.focus());
  const restart = () => {setStarted(false);setComplete(false);setStep(0);setAnswers(Array(questions.length).fill(null));focusHeading()};
  const score = questions.reduce((total,q,i)=>total+(q.correct!==undefined&&answers[i]===q.correct?1:0),0);
  const interest = ['Maths', 'Science', 'Maths & Science'][answers[0]];
  const summary = complete ? `My learning snapshot\nInterest: ${interest}\nWhen stuck: ${questions[1].options[answers[1]]}\nLesson preference: ${questions[2].options[answers[2]]}\nGoal: ${questions[3].options[answers[3]]}\nQuick check: ${score}/2 (two introductory questions only)` : '';
  const question = questions[step];
  const Icon = question.icon;
  return <section className="explorer section-wrap section-space" id="learning-check">
    <div className="section-heading"><div><span className="eyebrow">LET YOUR CURIOSITY LEAD</span><h2>A little test.<br/><span className="serif">A little more about you.</span></h2></div><p>Discover your interests and tell us how you like<br/>to tackle a challenge. Then try two quick questions.</p></div>
    <div className="explorer-shell">
      <div className="explorer-map"><span className="eyebrow">YOUR DISCOVERY TRAIL</span><ol>{[{name:'Your interests',icon:Compass,range:[0]}, {name:'Your approach',icon:Lightbulb,range:[1,2]}, {name:'Your goal',icon:Target,range:[3]}, {name:'Try it out',icon:Pencil,range:[4,5]}].map(({name,icon: TrailIcon,range},i)=><li key={name} className={complete||range.every(n=>answers[n]!==null)?'trail-done':started&&range.includes(step)?'trail-current':''} aria-current={!complete&&started&&range.includes(step)?'step':undefined}><span><TrailIcon size={22}/></span><div><small>0{i+1}</small><strong>{name}</strong></div>{(complete||range.every(n=>answers[n]!==null))&&<Check size={18}/>}</li>)}</ol><div className="explorer-map-note"><Sparkles size={22}/><p>Every student starts somewhere.<br/>This is your starting point.</p></div></div>
      <div className="explorer-body">
        {!started ? <><span className="explorer-big-icon"><Compass size={48}/></span><h3 ref={heading} tabIndex={-1}>What sparks your interest?</h3><p>6 short questions to help us get to know you.</p><div className="explorer-facts"><span><Check size={17}/> About 2 minutes</span><span><Check size={17}/> No sign-up</span><span><Check size={17}/> No timer</span></div><div className="mini-journey"><span><Compass/>Discover</span><ArrowRight/><span><Pencil/>Try</span><ArrowRight/><span><Target/>Reflect</span></div><button className="button primary" onClick={()=>{setStarted(true);focusHeading()}}>Discover my starting point <ArrowRight size={19}/></button><p className="explorer-caption">Your answers stay on this page unless you choose to share them in a trial enquiry.</p></> : complete ? <>
          <span className="eyebrow">YOUR LEARNING SNAPSHOT</span><h3 ref={heading} tabIndex={-1}>A starting point, made by you.</h3><div className="result-grid"><article><Compass/><span>You are curious about</span><strong>{interest}</strong></article><article><Target/><span>Your goal</span><strong>{questions[3].options[answers[3]]}</strong></article><article><Lightbulb/><span>When you get stuck, you said</span><strong>{questions[1].options[answers[1]]}</strong></article><article><BookOpen/><span>You would like to try</span><strong>{questions[2].options[answers[2]]}</strong></article></div>
          <div className="result-score"><span className="score-circle">{score}<small>/ 2</small></span><div><strong>Introductory questions answered correctly</strong><p>Just two questions, not a grade or a measure of your overall ability.</p></div></div>
          <details className="answer-review"><summary>See the answers & explanations</summary>{questions.filter(q=>q.correct!==undefined).map((q,i)=><article key={q.title}><strong>{q.title}</strong><p>Your answer: {q.options[answers[i+4]]}. {answers[i+4]===q.correct?'Correct.':'Something to explore together.'}</p><p>{q.explanation}</p></article>)}</details>
          <div className="trial-suggestion"><Sparkles size={22}/><p>For your trial, we can start with <strong>{interest}</strong> and <strong>{questions[2].options[answers[2]].toLowerCase()}</strong>.</p></div><p className="explorer-caption">This reflects your choices today. It is not a personality test or a fixed learning-style label.</p><div className="explorer-actions"><button className="button primary" onClick={()=>onTrial(summary)}>Use my snapshot for a free trial <ArrowRight size={18}/></button><button className="text-link" onClick={restart}><RotateCcw size={17}/> Start again</button></div>
        </> : <>
          <div className="question-progress"><span>Question {step+1} of {questions.length}</span><span>{step<4?'ABOUT YOU':'A LITTLE PRACTICE'}</span></div><progress value={step+1} max={questions.length} aria-label="Question progress"/>
          <span className="question-icon"><Icon size={27}/></span><h3 ref={heading} tabIndex={-1}>{question.title}</h3><p>{question.note}</p>
          {question.diagram==='pattern'&&<div className="number-pattern" aria-label="Number sequence: 2, 4, 8, unknown">{['2','4','8','?'].map((n,i)=><React.Fragment key={i}>{i>0&&<ArrowRight aria-hidden="true"/>}<span>{n}</span></React.Fragment>)}</div>}
          {question.diagram==='states'&&<div className="state-diagram" aria-label="Ice receives heat and becomes liquid water"><span><span className="ice-cube" aria-hidden="true"/>Ice</span><span className="heat-arrow">+ heat<ArrowRight aria-hidden="true"/></span><span><span className="water-drop" aria-hidden="true"/>Water</span></div>}
          <div className="explorer-options" role="group" aria-label={question.title}>{question.options.map((option,i)=>{const OptionIcon=question.icons?.[i];return <button key={`${step}-${i}`} aria-pressed={answers[step]===i} onClick={()=>setAnswers(current=>current.map((value,n)=>n===step?i:value))}>{OptionIcon?<OptionIcon size={23}/>:<span className="option-letter">{String.fromCharCode(65+i)}</span>}<span>{option}</span><span className="selection-dot">{answers[step]===i&&<Check size={14}/>}</span></button>})}</div>
          <div className="explorer-actions"><button className="text-link" onClick={()=>{if(step===0)setStarted(false);else setStep(step-1);focusHeading()}}><ArrowLeft size={17}/> Back</button><button className="button primary" disabled={answers[step]===null} onClick={()=>{if(step===questions.length-1)setComplete(true);else setStep(step+1);focusHeading()}}>{step===questions.length-1?'See my snapshot':'Next question'}<ArrowRight size={18}/></button></div>
        </>}
      </div>
    </div>
  </section>;
}
