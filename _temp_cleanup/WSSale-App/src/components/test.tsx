import { useState, useEffect } from 'react';

function Child({ initialData }: { initialData: any }) {
  const [val, setVal] = useState('');
  useEffect(() => {
    console.log('Child useEffect ran');
    setVal(initialData.val);
  }, [initialData]);
  console.log('Child render');
  return <div>{val}</div>;
}

export function Parent() {
  const [open, setOpen] = useState(false);
  console.log('Parent render');
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && <Child initialData={{ val: 'test' }} />}
    </div>
  );
}
