require('./loadEnv').loadLocalEnv();
const app = require('./app');
const initDefaultUser = require('./init/initUser');
const { checkLLMStatus } = require('./compensationAnalyzer');

const port = process.env.PORT || 3000;

async function bootstrap() {
  await initDefaultUser();
  const llmStatus = await checkLLMStatus();
  console.log(`[LLM] DeepSeek status: ${llmStatus.status}`);
  app.listen(port, () => {
    console.log(`Server running on ${port}`);
    app.resumePendingAnalysisTasks().catch(error => console.error('[AnalysisQueue] resume failed:', error.message));
  });
}

bootstrap();
