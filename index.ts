// The background task must be registered before the app component mounts.
import './src/lib/backgroundTask';
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
