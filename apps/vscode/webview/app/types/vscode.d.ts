declare module '#app' {
  interface NuxtApp {
    $vscode: {
      post(msg: unknown): void
      onMessage(handler: (data: unknown) => void): () => void
      available: boolean
    }
  }
}

export {}
