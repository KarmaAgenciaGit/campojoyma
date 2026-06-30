import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, SkipForward, SkipBack, Volume2, Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

interface AudioPlayerProps {
  audioBase64: string;
  className?: string;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({ audioBase64, className }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState(1);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      // Remove data URL prefix if present and clean the base64 string
      let base64Data = audioBase64.replace(/^data:audio\/[^;]+;base64,/, '');
      
      // Clean any whitespace and ensure proper base64 format
      base64Data = base64Data.replace(/\s/g, '');
      
      // Validate base64 format
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Data)) {
        throw new Error('Invalid base64 format');
      }
      
      // Decode base64 to binary data
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Create audio blob - try mp3 first as it's more common for base64 audio
      const audioBlob = new Blob([bytes], { type: 'audio/mp3' });
      const audioUrl = URL.createObjectURL(audioBlob);
      audio.src = audioUrl;

      const updateTime = () => setCurrentTime(audio.currentTime || 0);
      
      const updateDuration = () => {
        const dur = audio.duration;
        // Handle the case where duration might be infinity or invalid
        if (dur && isFinite(dur) && !isNaN(dur) && dur > 0) {
          setDuration(dur);
        } else {
          // For streaming or unknown duration, set a default or estimate
          setDuration(0);
        }
      };

      const handleEnded = () => setIsPlaying(false);
      
      const handleError = (e: Event) => {
        setDuration(0);
      };

      const handleCanPlay = () => {
        updateDuration();
      };

      const handleLoadStart = () => {
        setDuration(0);
        setCurrentTime(0);
      };

      const handleLoadedMetadata = () => {
        updateDuration();
      };

      // Add multiple event listeners to ensure duration is captured
      audio.addEventListener('timeupdate', updateTime);
      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      audio.addEventListener('loadeddata', updateDuration);
      audio.addEventListener('canplay', handleCanPlay);
      audio.addEventListener('canplaythrough', updateDuration);
      audio.addEventListener('durationchange', updateDuration);
      audio.addEventListener('loadstart', handleLoadStart);
      audio.addEventListener('ended', handleEnded);
      audio.addEventListener('error', handleError);

      // Force load the audio
      audio.load();

      return () => {
        if (audioUrl) {
          URL.revokeObjectURL(audioUrl);
        }
        audio.removeEventListener('timeupdate', updateTime);
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('loadeddata', updateDuration);
        audio.removeEventListener('canplay', handleCanPlay);
        audio.removeEventListener('canplaythrough', updateDuration);
        audio.removeEventListener('durationchange', updateDuration);
        audio.removeEventListener('loadstart', handleLoadStart);
        audio.removeEventListener('ended', handleEnded);
        audio.removeEventListener('error', handleError);
      };
    } catch (error) {
      setDuration(0);
    }
  }, [audioBase64]);

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (value: number[]) => {
    const audio = audioRef.current;
    if (!audio) return;

    const newTime = value[0];
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleVolumeChange = (value: number[]) => {
    const audio = audioRef.current;
    if (!audio) return;

    const newVolume = value[0];
    audio.volume = newVolume;
    setVolume(newVolume);
  };

  const skipForward = () => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.currentTime = Math.min(duration, audio.currentTime + 10);
  };

  const skipBackward = () => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.currentTime = Math.max(0, audio.currentTime - 10);
  };

  const cyclePlaybackSpeed = () => {
    const audio = audioRef.current;
    if (!audio) return;

    const speeds = [1, 1.25, 1.5, 1.75, 2];
    const currentIndex = speeds.indexOf(playbackRate);
    const nextIndex = (currentIndex + 1) % speeds.length;
    const newSpeed = speeds[nextIndex];
    
    audio.playbackRate = newSpeed;
    setPlaybackRate(newSpeed);
  };

  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time) || time <= 0) return '0:00';
    
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className={cn("w-full max-w-full", className)}>
      <audio ref={audioRef} />
      
      {/* Mobile Layout */}
      <div className="block sm:hidden">
        {/* Top row: Play/Pause and Speed controls */}
        <div className="flex items-center justify-center gap-3 mb-2">
          {/* Skip backward */}
          <Button
            variant="ghost"
            size="sm"
            onClick={skipBackward}
            className="h-8 w-8 p-0 flex-shrink-0 hover:bg-muted/50"
          >
            <SkipBack className="h-3 w-3" />
          </Button>
          
          {/* Play/Pause */}
          <Button
            variant="ghost"
            size="sm"
            onClick={togglePlayPause}
            className="h-9 w-9 p-0 rounded-full flex-shrink-0 hover:bg-muted/50"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          
          {/* Skip forward */}
          <Button
            variant="ghost"
            size="sm"
            onClick={skipForward}
            className="h-8 w-8 p-0 flex-shrink-0 hover:bg-muted/50"
          >
            <SkipForward className="h-3 w-3" />
          </Button>

          {/* Playback speed */}
          <Button
            variant="ghost"
            size="sm"
            onClick={cyclePlaybackSpeed}
            className="h-8 px-2 flex-shrink-0 hover:bg-muted/50 text-xs font-medium"
          >
            <Gauge className="h-3 w-3 mr-1" />
            {playbackRate}x
          </Button>
        </div>

        {/* Bottom row: Progress and time */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono min-w-[30px] text-center">
            {formatTime(currentTime)}
          </span>
          
          <div className="flex-1">
            <Slider
              value={[currentTime]}
              max={duration || 100}
              step={0.1}
              onValueChange={handleSeek}
              className="w-full"
            />
          </div>
          
          <span className="text-xs text-muted-foreground font-mono min-w-[30px] text-center">
            {formatTime(duration)}
          </span>
        </div>

        {/* Volume control - bottom */}
        <div className="flex items-center justify-center gap-2 mt-2">
          <Volume2 className="h-3 w-3 text-muted-foreground flex-shrink-0" />
          <div className="w-20">
            <Slider
              value={[volume]}
              max={1}
              step={0.1}
              onValueChange={handleVolumeChange}
              className="w-full"
            />
          </div>
        </div>
      </div>

      {/* Desktop Layout */}
      <div className="hidden sm:flex items-center gap-2 md:gap-3 w-full p-2">
        {/* Time display */}
        <span className="text-xs text-muted-foreground font-mono min-w-[35px]">
          {formatTime(currentTime)}
        </span>

        {/* Skip backward */}
        <Button
          variant="ghost"
          size="sm"
          onClick={skipBackward}
          className="h-8 w-8 p-0 flex-shrink-0 hover:bg-muted/50"
        >
          <SkipBack className="h-4 w-4" />
        </Button>
        
        {/* Play/Pause */}
        <Button
          variant="ghost"
          size="sm"
          onClick={togglePlayPause}
          className="h-10 w-10 p-0 rounded-full flex-shrink-0 hover:bg-muted/50"
        >
          {isPlaying ? (
            <Pause className="h-5 w-5" />
          ) : (
            <Play className="h-5 w-5" />
          )}
        </Button>
        
        {/* Skip forward */}
        <Button
          variant="ghost"
          size="sm"
          onClick={skipForward}
          className="h-8 w-8 p-0 flex-shrink-0 hover:bg-muted/50"
        >
          <SkipForward className="h-4 w-4" />
        </Button>

        {/* Playback speed */}
        <Button
          variant="ghost"
          size="sm"
          onClick={cyclePlaybackSpeed}
          className="h-8 px-2 sm:px-3 flex-shrink-0 hover:bg-muted/50 text-xs sm:text-sm font-medium"
        >
          <Gauge className="h-3 w-3 sm:h-4 sm:w-4 mr-1" />
          <span className="hidden md:inline">{playbackRate}x</span>
          <span className="md:hidden">{playbackRate}</span>
        </Button>

        {/* Progress slider */}
        <div className="flex-1 mx-2">
          <Slider
            value={[currentTime]}
            max={duration || 100}
            step={0.1}
            onValueChange={handleSeek}
            className="w-full"
          />
        </div>

        {/* Duration */}
        <span className="text-xs text-muted-foreground font-mono min-w-[35px]">
          {formatTime(duration)}
        </span>

        {/* Volume control */}
        <div className="flex items-center gap-2 min-w-[80px]">
          <Volume2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <Slider
            value={[volume]}
            max={1}
            step={0.1}
            onValueChange={handleVolumeChange}
            className="w-16"
          />
        </div>
      </div>
    </div>
  );
};