import {AuthBoundary} from '@/components/auth/boundary';
import {AppPlaceholder} from '@/components/auth/placeholder';
export default function App(){return <main id="main" className="product page-center"><AuthBoundary><AppPlaceholder/></AuthBoundary></main>;}
