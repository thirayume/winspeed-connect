import { useEffect } from 'react';
import { socketService } from '../services/socket';

/**
 * React Hook to listen for specific Socket.IO events.
 * Automatically connects to the socket server if not already connected.
 * 
 * @param eventName The name of the event to listen for
 * @param callback The function to execute when the event is received
 */
export function useSocketEvent<T>(eventName: string, callback: (data: T) => void) {
  useEffect(() => {
    // Ensure socket is connected
    const socket = socketService.connect();
    
    // Define the event listener
    const handleEvent = (data: T) => {
      callback(data);
    };

    // Attach the listener
    socket.on(eventName, handleEvent);

    // Cleanup listener on component unmount
    return () => {
      socket.off(eventName, handleEvent);
    };
  }, [eventName, callback]);
}
