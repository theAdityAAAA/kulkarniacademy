import React from 'react';
import { ArrowUpRight, Award, BookOpenCheck, Cpu, Quote, Star } from 'lucide-react';
import './Tutor.css';

const highlights = [
  { icon: Award, figure: 'Top 1.3%', label: '98.7 percentile in a highly competitive engineering entrance exam in Maths, Physics & Chemistry', note: 'MHT-CET, India' },
  { icon: Cpu, figure: 'Engineer', label: 'Computer Science engineer who turns big problems into clear, simple steps' },
  { icon: BookOpenCheck, figure: 'IB · IGCSE', label: 'MYP, DP, IGCSE, GCSE and every other international board' },
];

const reviews = [
  { quote: 'A great place to learn, excellent and friendly teachers and reasonable pricing. My son loved it.', name: 'Sahithya', role: 'Parent', source: 'Google review' },
];

export default function Tutor({ onTrial }) {
  return <section className="tutor-section section-wrap section-space" id="tutor">
    <div className="tutor-grid">
      <div className="tutor-profile">
        <span className="eyebrow">MEET YOUR TUTOR</span>
        <div className="tutor-name-row">
          <span className="tutor-avatar" aria-hidden="true">AK</span>
          <div><h2>Aditya Kulkarni</h2><p className="tutor-title">Engineer &amp; Maths and Science tutor</p></div>
        </div>
        <p className="tutor-bio">I’m a Computer Science engineer, and I placed in the top 1.3% of a highly competitive engineering entrance exam in Maths, Physics and Chemistry. I know how it feels when a topic just won’t make sense. In my classes we slow down, ask “why?”, and work through it together until it clicks, whatever your board and wherever you live.</p>
        <button className="text-link purple-link" onClick={() => onTrial('I’d like a free trial class with Aditya.')}>Book a free class with Aditya <ArrowUpRight size={18}/></button>
      </div>
      <div className="tutor-reviews">
        <span className="eyebrow">WHAT PARENTS SAY</span>
        {reviews.map(({ quote, name, role, source }) => <figure className="review-card" key={name}>
          <Quote className="review-mark" size={34} aria-hidden="true"/>
          <div className="review-stars" role="img" aria-label="Rated 5 out of 5">{Array.from({ length: 5 }, (_, i) => <Star key={i} size={17}/>)}</div>
          <blockquote>“{quote}”</blockquote>
          <figcaption><span className="review-initial" aria-hidden="true">{name[0]}</span><span><strong>{name}</strong>{role} · {source}</span></figcaption>
        </figure>)}
      </div>
    </div>
    <ul className="tutor-highlights">{highlights.map(({ icon: Icon, figure, label, note }) => <li key={figure}>
      <span className="tutor-highlight-icon"><Icon size={21}/></span>
      <strong>{figure}</strong>
      <p>{label}</p>
      {note && <small>{note}</small>}
    </li>)}</ul>
  </section>;
}
