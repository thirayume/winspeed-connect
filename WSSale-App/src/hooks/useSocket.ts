import { useEffect, useRef } from 'react';
import { socketService } from '../services/socket';
import { refreshQueue } from '../utils/refresh-queue';

/**
 * React Hook to listen for specific Socket.IO events.
 * Automatically connects to the socket server if not already connected.
 * 
 * @param eventName The name of the event to listen for
 * @param callback The function to execute when the event is received
 */
export function useSocketEvent<T>(eventName: string, callback: (data: T) => unknown | Promise<unknown>) {
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => {
    // Ensure socket is connected
    const socket = socketService.connect();
    
    // Define the event listener
    let data: T;
    const queue = refreshQueue(() => latest.current(data), 500 + Math.floor(Math.random() * 500));
    queue.pause(document.hidden);
    const handleEvent = (value: T) => { data = value; queue.request(); };
    const onVisible = () => queue.pause(document.hidden);

    // Attach the listener
    socket.on(eventName, handleEvent);
    document.addEventListener('visibilitychange', onVisible);

    // Cleanup listener on component unmount
    return () => {
      queue.stop();
      socket.off(eventName, handleEvent);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [eventName]);
}
