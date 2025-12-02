export const mockLLM = {
  async call(prompt: string, delay: number = 500): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, delay));
    return `Response to: ${prompt.substring(0, 50)}...`;
  },

  async embed(text: string, delay: number = 500): Promise<number[]> {
    await new Promise(resolve => setTimeout(resolve, delay));
    return text.split('').map((c, i) => c.charCodeAt(0) + i);
  },

  async searchWeb(query: string, delay: number = 500): Promise<string> {
    await new Promise(resolve => setTimeout(resolve, delay));
    return `Search results for: ${query}`;
  }
};
