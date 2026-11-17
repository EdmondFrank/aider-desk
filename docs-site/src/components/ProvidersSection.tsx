import { clsx } from 'clsx';
import Link from '@docusaurus/Link';
import { CpuIcon, ArrowRightIcon } from './Icons';
import styles from './ProvidersSection.module.css';

type ProviderItem = {
  name: string;
  category: string;
  models: string;
  features: string;
};

const PROVIDERS: ProviderItem[] = [
  {
    name: 'Anthropic',
    category: 'Reasoning & Coding',
    models: 'Claude Fable 5.2, Claude Haiku 5.5',
    features: 'Extended thinking, prompt caching, vision support',
  },
  {
    name: 'OpenAI',
    category: 'Frontier Models',
    models: 'GPT-6 Sol, GPT-6.1 Terra, GPT-6 Luna',
    features: 'Reasoning effort levels, fast tool calls',
  },
  {
    name: 'Google',
    category: 'Massive Context',
    models: 'Gemini 4 Carbon, Gemini 4 Hydrogen, Gemini 4 Argon',
    features: '1M+ token context window, ultra-low latency',
  },
  {
    name: 'DeepSeek',
    category: 'Open Weights & Hosted',
    models: 'DeepSeek V4 Pro, DeepSeek V4.1 Flash',
    features: 'Exceptional math/code reasoning at low cost',
  },
  {
    name: 'Ollama & LM Studio',
    category: '100% Local & Offline',
    models: 'Qwen4 Max, GLM-5.3, Muse Ember, Llama 4',
    features: 'Zero external network calls, air-gapped security',
  },
  {
    name: 'Enterprise Cloud',
    category: 'Enterprise VPC',
    models: 'AWS Bedrock, Azure OpenAI, GCP Vertex AI',
    features: 'Corporate compliance, IAM & VPC endpoint support',
  },
  {
    name: 'High-Speed Hubs',
    category: 'Inference Engines',
    models: 'Groq, Cerebras, OpenRouter, Mistral, xAI',
    features: 'Hundreds of specialized models & LPU inference speed',
  },
  {
    name: 'Custom Endpoints',
    category: 'Any OpenAI-Compatible API',
    models: 'vLLM, LiteLLM, LocalAI, text-generation-webui',
    features: 'Connect any custom model URL with bearer auth',
  },
];

type Props = {
  className?: string;
};

export const ProvidersSection = ({ className }: Props) => {
  return (
    <section className={clsx(styles.section, className)}>
      <div className={styles.header}>
        <div className={styles.sectionBadge}>Universal Model Support</div>
        <h2 className={styles.heading}>Bring any model. Switch mid-task.</h2>
        <p className={styles.subheading}>
          No artificial restrictions. Connect directly using your own API keys or run completely offline with local weights.
        </p>
      </div>

      <div className={styles.grid}>
        {PROVIDERS.map((provider) => (
          <div key={provider.name} className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.iconBox}>
                <CpuIcon size={18} />
              </div>
              <div className={styles.titleBox}>
                <h3 className={styles.providerName}>{provider.name}</h3>
                <span className={styles.providerCategory}>{provider.category}</span>
              </div>
            </div>
            <div className={styles.modelsList}>{provider.models}</div>
            <div className={styles.featuresList}>{provider.features}</div>
          </div>
        ))}
      </div>

      <div className={styles.footerNote}>
        <span>Need a custom provider? Configure custom endpoints in Settings or models.json.</span>
        <Link to="/docs/configuration/providers" className={styles.docsLink}>
          <span>View all supported providers</span>
          <ArrowRightIcon size={14} />
        </Link>
      </div>
    </section>
  );
};
