import '@fontsource/fraunces/600.css'
import '@fontsource/outfit/400.css'
import '@fontsource/outfit/500.css'
import '@fontsource/outfit/600.css'
import './style.css'
import { Game } from './game/Game.ts'

const game = new Game()
void game.start()
