import { registerRootComponent } from 'expo';
import App from './App';

// registerRootComponent woła AppRegistry.registerComponent('main', () => App);
// + zapewnia że App.tsx ładuje się jako root w Expo Go i bundled app.
registerRootComponent(App);
