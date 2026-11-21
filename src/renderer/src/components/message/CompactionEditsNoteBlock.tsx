import { CompactionSnippetBlock } from './CompactionSnippetBlock';

type Props = {
  filePaths: string[];
};

export const CompactionEditsNoteBlock = ({ filePaths }: Props) => {
  return (
    <div className="flex flex-col gap-1">
      {filePaths.map((filePath) => (
        <CompactionSnippetBlock key={filePath} filePath={filePath} />
      ))}
    </div>
  );
};
