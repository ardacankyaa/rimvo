import play from '../assets/icons/play.svg?raw';
import pause from '../assets/icons/pause.svg?raw';
import folder from '../assets/icons/folder-open.svg?raw';
import plus from '../assets/icons/plus.svg?raw';
import question from '../assets/icons/question.svg?raw';
import power from '../assets/icons/power.svg?raw';
import search from '../assets/icons/magnifying-glass.svg?raw';
import left from '../assets/icons/arrow-left.svg?raw';
import right from '../assets/icons/arrow-right.svg?raw';
import pin from '../assets/icons/push-pin.svg?raw';

// Phosphor regular, MIT. Only reviewed, vendored static SVGs can enter this registry.
const icons={play,pause,folder,plus,question,power,search,left,right,pin};
export function Icon({name}:{readonly name:keyof typeof icons}){
  return <span className="icon" aria-hidden="true" dangerouslySetInnerHTML={{__html:icons[name]}} />;
}
