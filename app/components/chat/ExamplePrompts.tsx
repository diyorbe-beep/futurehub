import React from 'react';

const EXAMPLE_PROMPTS = [
  { text: 'Create a mobile app about futureHub' },
  { text: 'Build a todo app in React using Tailwind' },
  { text: 'Build a simple blog using Astro' },
  { text: 'Create a cookie consent form using Material UI' },
  { text: 'Make a space invaders game' },
  { text: 'Make a Tic Tac Toe game in html, css and js only' },
];

export function ExamplePrompts(sendMessage?: { (event: React.UIEvent, messageInput?: string): void | undefined }) {
  return (
    <div id="examples" className="relative flex flex-col gap-9 w-full max-w-4xl mx-auto flex justify-center mt-6 z-10">
      <div
        className="flex flex-wrap justify-center gap-3 px-4"
        style={{
          animation: 'slideUpFade .4s cubic-bezier(0.16,1,0.3,1) forwards',
        }}
      >
        {EXAMPLE_PROMPTS.map((examplePrompt, index: number) => {
          return (
            <button
              key={index}
              style={{ animationDelay: `${index * 0.05}s` }}
              onClick={(event) => {
                sendMessage?.(event, examplePrompt.text);
              }}
              className="animate-slide-up-fade border border-bolt-elements-borderColor/50 rounded-full bg-white/50 hover:bg-white dark:bg-gray-900/50 dark:hover:bg-gray-900 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary px-4 py-2 text-[13px] font-medium transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)] hover:scale-[1.03] active:scale-[0.97] hover:shadow-[0_4px_16px_rgba(20,184,166,0.15)] hover:border-accent-500/30 backdrop-blur-md"
            >
              {examplePrompt.text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
