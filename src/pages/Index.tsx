import MidiPlayer from "@/components/midi/MidiPlayer";
import CurvedLoop from "@/components/CurvedLoop";
import Aurora from "@/components/Aurora";
import Balatro from "@/components/Balatro";
import AnimatedContent from "@/components/AnimatedContent";
import {BackgroundLines} from "@/components/ui/background-lines";
import { useState, useCallback, useRef, useEffect } from "react";

const Index = () => {
  const [shakeOffset, setShakeOffset] = useState({ x: 0, y: 0, rotation: 0 });
  const [backgroundOpacity, setBackgroundOpacity] = useState(0.2);
  const shakeTimeoutRef = useRef<NodeJS.Timeout>();
  const containerRef = useRef<HTMLDivElement>(null);
  const noteTimestampsRef = useRef<number[]>([]);

  const handleNoteTrigger = useCallback((midi: number, velocity: number) => {
    // Track note timestamp
    const now = Date.now();
    noteTimestampsRef.current.push(now);
    
    // Clean up old timestamps (older than 10 seconds)
    const tenSecondsAgo = now - 2000;
    noteTimestampsRef.current = noteTimestampsRef.current.filter(timestamp => timestamp > tenSecondsAgo);
    
    // Calculate opacity based on note density (notes per 10 seconds)
    const notesInWindow = noteTimestampsRef.current.length;
    const baseOpacity = 0.2;
    const maxOpacity = 0.8;
    const opacityIncrease = Math.min(notesInWindow * 0.1, maxOpacity - baseOpacity);
    const newOpacity = baseOpacity + opacityIncrease;
    
    setBackgroundOpacity(newOpacity);

    // Calculate shake intensity based on note velocity
    const intensity = velocity * 6; // Max 6px shake
    
    // Generate random shake direction based on note
    const angle = (midi * 137.5) % 360; // Use golden angle for varied directions
    const shakeX = Math.cos(angle * Math.PI / 180) * intensity;
    const shakeY = Math.sin(angle * Math.PI / 180) * intensity;
    const shakeRotation = (Math.random() - 0.5) * intensity * 0.2;
    
    // Apply immediate shake
    setShakeOffset({ x: shakeX, y: shakeY, rotation: shakeRotation });
    
    // Clear any existing timeout
    if (shakeTimeoutRef.current) {
      clearTimeout(shakeTimeoutRef.current);
    }
    
    // Reset shake after short duration
    shakeTimeoutRef.current = setTimeout(() => {
      setShakeOffset({ x: 0, y: 0, rotation: 0 });
    }, 150); // 150ms quick shake
  }, []);

  // Apply shake transform to the container
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.transform = 
        `scale(1.08) translate(${shakeOffset.x}px, ${shakeOffset.y}px) rotate(${shakeOffset.rotation}deg)`;
    }
  }, [shakeOffset]);

  // Periodically clean up old timestamps and update opacity
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const twoSecondsAgo = now - 1000; // 2 seconds
      
      // Clean up old timestamps
      const previousLength = noteTimestampsRef.current.length;
      noteTimestampsRef.current = noteTimestampsRef.current.filter(timestamp => timestamp > twoSecondsAgo);

      // Update opacity if timestamps were cleaned up
      if (noteTimestampsRef.current.length !== previousLength) {
        const notesInWindow = noteTimestampsRef.current.length;
        const baseOpacity = 0.2;
        const maxOpacity = 0.8;
        const opacityIncrease = Math.min(notesInWindow * 0.1, maxOpacity - baseOpacity);
        const newOpacity = baseOpacity + opacityIncrease;
        
        setBackgroundOpacity(newOpacity);
      }
    }, 1000); // Check every second

    return () => clearInterval(interval);
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div 
        ref={containerRef}
        className="absolute inset-0 -z-10"
        style={{ 
          transformOrigin: 'center',
          willChange: 'transform, opacity',
          opacity: backgroundOpacity,
          transition: 'opacity 0.8s ease-out'
        }}
      >
        <BackgroundLines>
          <div className="w-full h-full opacity-100">
              <Aurora/>
          </div>
        </BackgroundLines>
      </div>
      <MidiPlayer onNoteTrigger={handleNoteTrigger} />
    </main>
  );
};

export default Index;
