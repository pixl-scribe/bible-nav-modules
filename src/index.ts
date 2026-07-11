import yargs, { CommandModule } from 'yargs';
import { hideBin } from 'yargs/helpers';
import ModuleFactory from './module-factory';

// 1. Define the shape of your command arguments
interface GreetArgs {
  id: string;
}

// 2. Create the command module
export const greetCommand: CommandModule<unknown, GreetArgs> = {
  command: 'generate',
  describe: 'Generates a Bible Nav module',

  // 3. Define the options and type definitions
  builder: (y) =>
    y
      .option('id', {
        alias: 'id',
        type: 'string',
        describe: 'The module ID to read from the assets folder',
        demandOption: true, // Make it required
      })
      .help('h') // Enable --help with alias -h
      .alias('h', 'help')
      .strict(),

  // 4. Handle the parsed arguments
  handler: (argv) => {
    // argv is strictly typed as GreetArgs
    ModuleFactory.generate(argv.id);
  },
};

// 5. Wire up to process.argv
yargs(hideBin(process.argv))
  .command(greetCommand)
  .demandCommand(1, 'You need at least one command before moving on')
  .help()
  .parse();
